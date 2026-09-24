import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { ALL_PERMISSION_CODES } from "@/lib/permissions/catalog";
import { loadActor, type SessionActor } from "@/server/auth/actor";
import { hashPassword } from "@/server/auth/password";
import { createRole, updateRolePermissions } from "@/server/roles/service";
import {
  createUser, lockAdminInvariant, resetPassword, setLocked, setUserRoles, updateProfile,
} from "@/server/users/service";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";

/**
 * Không leo thang đặc quyền: KHÔNG được cấp/ảnh hưởng vượt quá những gì chính mình đang có.
 * Actor dựng từ DB thật (loadActor) như trong request. Mỗi lần bị từ chối: hàng dữ liệu không đổi + 0 dòng audit mới.
 */
const tx = <T,>(fn: (db: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(fn);
const FORBIDDEN = 403;

let roleId: Record<string, number>;
let director: SessionActor; // Giám đốc: giữ mọi quyền
let directorId: number;
let umActor: SessionActor; // chỉ user.view + user.manage
let rmActor: SessionActor; // chỉ role.manage
let umRoleId: number;
let rmRoleId: number;

async function roleWith(name: string, codes: string[]) {
  const role = await prisma.role.create({ data: { name } });
  const perms = await prisma.permission.findMany({ where: { code: { in: codes } } });
  await prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  return role.id;
}
async function userWith(username: string, roleIds: number[]) {
  const u = await prisma.user.create({
    data: { username, fullName: username, passwordHash: await hashPassword("Cu12345678"), roles: { create: roleIds.map((roleId) => ({ roleId })) } },
  });
  return u.id;
}
const actorOf = async (id: number) => (await loadActor(prisma, id))!;
const auditCount = () => prisma.auditLog.count();
const userRow = (id: number) => prisma.user.findUniqueOrThrow({ where: { id } });
const roleIdsOf = async (id: number) => (await prisma.userRole.findMany({ where: { userId: id } })).map((r) => r.roleId).sort();
const codesOf = async (rid: number) =>
  (await prisma.rolePermission.findMany({ where: { roleId: rid }, include: { permission: true } })).map((r) => r.permission.code).sort();

/** Chạy `fn` mong đợi bị từ chối 403; khẳng định không ghi audit. */
async function expectForbidden(fn: () => Promise<unknown>, message?: RegExp) {
  const before = await auditCount();
  const err = await fn().then(() => null, (e: unknown) => e as { status?: number; message: string });
  expect(err, "phải bị từ chối").not.toBeNull();
  expect(err!.status).toBe(FORBIDDEN);
  if (message) expect(err!.message).toMatch(message);
  expect(await auditCount()).toBe(before);
}

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
  roleId = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));
  directorId = await userWith("giamdoc", [roleId["Giám đốc"]!]);
  umRoleId = await roleWith("QL tài khoản", ["user.view", "user.manage"]);
  rmRoleId = await roleWith("QL nhóm quyền", ["role.manage"]);
  director = await actorOf(directorId);
  umActor = await actorOf(await userWith("ql", [umRoleId]));
  rmActor = await actorOf(await userWith("qn", [rmRoleId]));
});

describe("(a) cấp quyền cho nhóm: chỉ được THÊM quyền mà chính mình có", () => {
  it("chỉ có role.manage: KHÔNG thêm user.manage vào nhóm của chính mình (nâng quyền) — dữ liệu không đổi", async () => {
    await expectForbidden(() => tx((db) => updateRolePermissions(db, rmActor, rmRoleId, ["role.manage", "user.manage"])), /user\.manage/);
    expect(await codesOf(rmRoleId)).toEqual(["role.manage"]);
  });

  it("chỉ có role.manage: KHÔNG thêm period.close vào nhóm khác", async () => {
    const other = await roleWith("Nhóm phụ", ["order.view"]);
    await expectForbidden(() => tx((db) => updateRolePermissions(db, rmActor, other, ["order.view", "period.close"])), /period\.close/);
    expect(await codesOf(other)).toEqual(["order.view"]);
  });

  it("thông báo tiếng Việt nêu quyền bị từ chối", async () => {
    await expectForbidden(() => tx((db) => updateRolePermissions(db, rmActor, rmRoleId, ["role.manage", "cost.view"])), /^Bạn không thể cấp quyền mà chính bạn không có: .*cost\.view/);
  });

  it("được thêm quyền mình có; quyền đã có sẵn trong nhóm (dù mình không có) giữ nguyên thì KHÔNG bị tính là 'thêm'", async () => {
    const other = await roleWith("Nhóm giá vốn", ["cost.view"]);
    await tx((db) => updateRolePermissions(db, rmActor, other, ["cost.view", "role.manage"]));
    expect(await codesOf(other)).toEqual(["cost.view", "role.manage"]);
  });

  it("Giám đốc thêm bất kỳ quyền nào được", async () => {
    await tx((db) => updateRolePermissions(db, director, rmRoleId, [...ALL_PERMISSION_CODES]));
    expect(await codesOf(rmRoleId)).toHaveLength(ALL_PERMISSION_CODES.length);
  });

  it("tạo nhóm mới luôn rỗng (không có đường cấp quyền qua createRole)", async () => {
    const r = await tx((db) => createRole(db, rmActor, { name: "Nhóm mới" }));
    expect(await codesOf(r.id)).toEqual([]);
  });
});

describe("(b) gán vai trò: vai trò mới phải có quyền ⊆ quyền của mình", () => {
  it("chỉ có user.manage: KHÔNG tự gán Giám đốc cho mình", async () => {
    const before = await roleIdsOf(umActor.userId);
    await expectForbidden(() => tx((db) => setUserRoles(db, umActor, umActor.userId, [umRoleId, roleId["Giám đốc"]!])), /không thể cấp quyền/);
    expect(await roleIdsOf(umActor.userId)).toEqual(before);
  });

  it("chỉ có user.manage: KHÔNG gán Giám đốc cho người khác", async () => {
    // đối tượng có quyền thấp → chỉ điều kiện (b) (vai trò MỚI) có thể chặn
    const low = await roleWith("Chỉ xem", ["user.view"]);
    const nv = await userWith("nv", [low]);
    await expectForbidden(() => tx((db) => setUserRoles(db, umActor, nv, [low, roleId["Giám đốc"]!])), /không thể cấp quyền/);
    expect(await roleIdsOf(nv)).toEqual([low]);
  });

  it("chỉ có user.manage: KHÔNG tạo user với vai trò Giám đốc (không tạo hàng nào)", async () => {
    const users = await prisma.user.count();
    await expectForbidden(() => tx((db) => createUser(db, umActor, { username: "moi", fullName: "Mới", roleIds: [roleId["Giám đốc"]!] })), /không thể cấp quyền/);
    expect(await prisma.user.count()).toBe(users);
  });

  it("được gán/tạo user với vai trò có quyền ⊆ quyền của mình", async () => {
    const low = await roleWith("Chỉ xem", ["user.view"]);
    const r = await tx((db) => createUser(db, umActor, { username: "moi", fullName: "Mới", roleIds: [low] }));
    expect(await roleIdsOf(r.id)).toEqual([low]);
    const nv = await userWith("nv", [low]);
    await tx((db) => setUserRoles(db, umActor, nv, [low, umRoleId]));
    expect(await roleIdsOf(nv)).toEqual([low, umRoleId].sort());
  });

  it("không thể gỡ/thay vai trò cao hơn mình của người khác (người đó giữ Giám đốc)", async () => {
    const target = await userWith("sep2", [roleId["Giám đốc"]!]);
    await expectForbidden(() => tx((db) => setUserRoles(db, umActor, target, [umRoleId])));
    expect(await roleIdsOf(target)).toEqual([roleId["Giám đốc"]]);
  });

  it("Giám đốc gán mọi vai trò được", async () => {
    const nv = await userWith("nv", [roleId["Bán hàng"]!]);
    await tx((db) => setUserRoles(db, director, nv, [roleId["Giám đốc"]!]));
    expect(await roleIdsOf(nv)).toEqual([roleId["Giám đốc"]]);
  });
});

describe("(c) thao tác trên tài khoản khác: quyền của đối tượng phải ⊆ quyền của mình", () => {
  it("KHÔNG cấp lại mật khẩu của Giám đốc (chiếm tài khoản) — hash + mustChange giữ nguyên", async () => {
    const before = await userRow(directorId);
    await expectForbidden(() => tx((db) => resetPassword(db, umActor, directorId)), /cao hơn/);
    const after = await userRow(directorId);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.mustChangePassword).toBe(before.mustChangePassword);
  });

  it("KHÔNG khoá Giám đốc; kiểm quyền chạy TRƯỚC bất biến 'còn quản trị viên' (khoá xong sẽ hết admin nhưng vẫn báo 403, không phải lỗi hết admin)", async () => {
    await prisma.user.update({ where: { id: umActor.userId }, data: { isLocked: true } }); // Giám đốc là admin hoạt động duy nhất
    await expectForbidden(() => tx((db) => setLocked(db, umActor, directorId, true)), /cao hơn/);
    expect((await userRow(directorId)).isLocked).toBe(false);
  });

  it("KHÔNG mở khoá Giám đốc; KHÔNG sửa họ tên Giám đốc", async () => {
    await prisma.user.update({ where: { id: directorId }, data: { isLocked: true } });
    await expectForbidden(() => tx((db) => setLocked(db, umActor, directorId, false)), /cao hơn/);
    expect((await userRow(directorId)).isLocked).toBe(true);
    await prisma.user.update({ where: { id: directorId }, data: { isLocked: false } });
    await expectForbidden(() => tx((db) => updateProfile(db, umActor, directorId, { fullName: "Bị đổi" })), /cao hơn/);
    expect((await userRow(directorId)).fullName).toBe("giamdoc");
  });

  it("KHÔNG thao tác trên user có quyền vượt mình dù chỉ một quyền (Bán hàng có order.view mà mình không có)", async () => {
    const nam = await userWith("nam", [roleId["Bán hàng"]!]);
    await expectForbidden(() => tx((db) => resetPassword(db, umActor, nam)), /cao hơn/);
  });

  it("quyền là HỢP các vai trò của đối tượng: 1 vai trò thấp + 1 vai trò cao vẫn bị chặn", async () => {
    const low = await roleWith("Chỉ xem", ["user.view"]);
    const mixed = await userWith("mixed", [low, roleId["Giám đốc"]!]);
    await expectForbidden(() => tx((db) => resetPassword(db, umActor, mixed)), /cao hơn/);
  });

  it("ĐƯỢC cấp lại/khoá/mở khoá/sửa họ tên user có quyền ⊆ quyền của mình; tự cấp lại mật khẩu của mình", async () => {
    const low = await roleWith("Chỉ xem", ["user.view"]);
    const nv = await userWith("nv", [low]);
    const r = await tx((db) => resetPassword(db, umActor, nv));
    expect(r.tempPassword).toEqual(expect.any(String));
    await tx((db) => setLocked(db, umActor, nv, true));
    expect((await userRow(nv)).isLocked).toBe(true);
    await tx((db) => setLocked(db, umActor, nv, false));
    await tx((db) => updateProfile(db, umActor, nv, { fullName: "Tên mới" }));
    expect((await userRow(nv)).fullName).toBe("Tên mới");
    await tx((db) => resetPassword(db, umActor, umActor.userId));
  });

  it("Giám đốc làm được mọi thao tác trên mọi người", async () => {
    const nam = await userWith("nam", [roleId["Bán hàng"]!]);
    const boss2 = await userWith("boss2", [roleId["Giám đốc"]!]);
    await tx((db) => resetPassword(db, director, boss2));
    await tx((db) => setLocked(db, director, boss2, true));
    await tx((db) => updateProfile(db, director, nam, { fullName: "X Y" }));
    expect((await userRow(boss2)).isLocked).toBe(true);
  });
});

describe("TOCTOU: đọc quyền của đối tượng chạy SAU khoá advisory (không đua với việc nâng quyền đồng thời)", () => {
  /** Giữ khoá advisory trong 1 transaction; trả hàm nhả khoá. */
  async function holdLock() {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let acquired!: () => void;
    const got = new Promise<void>((r) => (acquired = r));
    const done = prisma.$transaction(async (db) => {
      await lockAdminInvariant(db);
      acquired();
      await gate;
    });
    await got;
    return { release, done };
  }
  const pendingFor = async (p: Promise<unknown>) => {
    let settled = false;
    void p.then(() => (settled = true), () => (settled = true));
    await new Promise((r) => setTimeout(r, 400));
    return !settled;
  };

  it("resetPassword chờ khoá (không đọc quyền đối tượng khi người khác đang đổi quyền)", async () => {
    const low = await roleWith("Chỉ xem", ["user.view"]);
    const nv = await userWith("nv", [low]);
    const lock = await holdLock();
    const op = tx((db) => resetPassword(db, umActor, nv));
    expect(await pendingFor(op)).toBe(true);
    lock.release();
    await lock.done;
    expect((await op).tempPassword).toEqual(expect.any(String));
  });

  it("mở khoá (setLocked false) cũng chờ khoá", async () => {
    const low = await roleWith("Chỉ xem", ["user.view"]);
    const nv = await userWith("nv", [low]);
    await prisma.user.update({ where: { id: nv }, data: { isLocked: true } });
    const lock = await holdLock();
    const op = tx((db) => setLocked(db, umActor, nv, false));
    expect(await pendingFor(op)).toBe(true);
    lock.release();
    await lock.done;
    await op;
    expect((await userRow(nv)).isLocked).toBe(false);
  });
});
