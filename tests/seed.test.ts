import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialPeriodName, parseBootstrapEmail, seed } from "../prisma/seed-lib";
import { PERMISSIONS } from "@/lib/permissions/catalog";
import { loadActor } from "@/server/auth/actor";
import { BCRYPT_COST } from "@/server/auth/password";
import { updateRolePermissions } from "@/server/roles/service";
import { prisma, resetDb } from "./helpers/db";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("seed", () => {
  it("tạo quyền, 5 vai trò, công ty, đúng 1 kỳ OPEN", async () => {
    await seed(prisma);
    expect(await prisma.permission.count()).toBe(PERMISSIONS.length);
    expect((await prisma.role.findMany()).map((r) => r.name).sort()).toEqual(
      ["Bán hàng", "Giám đốc", "Kế toán", "Thủ kho", "Thủ quỹ"].sort(),
    );
    expect(await prisma.companySetting.count()).toBe(1);
    const open = await prisma.period.findMany({ where: { isOpen: true } });
    expect(open).toHaveLength(1);
    expect(open[0]!.status).toBe("OPEN");
    expect(open[0]!.name).toBe(initialPeriodName(new Date()));
  });

  it("tên kỳ đầu theo NGÀY ICT, không theo múi giờ máy chủ (container UTC)", () => {
    // 17:30Z 31/12/2026 = 00:30 ICT 01/01/2027 — server UTC dùng getDate() sẽ ra 31/12/2026
    expect(initialPeriodName(new Date("2026-12-31T17:30:00Z"))).toBe("Kỳ khởi tạo 01/01/2027");
    expect(initialPeriodName(new Date("2026-09-24T16:59:59Z"))).toBe("Kỳ khởi tạo 24/09/2026");
  });

  it("idempotent: chạy 2 lần không nhân đôi dữ liệu", async () => {
    await seed(prisma);
    const rolePerms = await prisma.rolePermission.count();
    await seed(prisma);
    expect(await prisma.permission.count()).toBe(PERMISSIONS.length);
    expect(await prisma.role.count()).toBe(5);
    expect(await prisma.rolePermission.count()).toBe(rolePerms);
    expect(await prisma.companySetting.count()).toBe(1);
    expect(await prisma.period.count()).toBe(1);
    expect(await prisma.period.count({ where: { isOpen: true } })).toBe(1);
  });

  it("KHÔNG ghi đè quyền khách đã chỉnh sau khi vai trò đã tồn tại", async () => {
    await seed(prisma);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "Thủ kho" } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } }); // khách bỏ hết quyền
    await seed(prisma);
    expect(await prisma.rolePermission.count({ where: { roleId: role.id } })).toBe(0);
  });

  it("vai trò Thủ kho không có quyền xem giá vốn trong DB", async () => {
    await seed(prisma);
    const rows = await prisma.rolePermission.findMany({
      where: { role: { name: "Thủ kho" }, permission: { code: "cost.view" } },
    });
    expect(rows).toHaveLength(0);
  });

  it("Giám đốc trong DB có đủ mọi quyền", async () => {
    await seed(prisma);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "Giám đốc" } });
    expect(await prisma.rolePermission.count({ where: { roleId: role.id } })).toBe(PERMISSIONS.length);
  });

  it("tạo admin khởi tạo khi có mật khẩu và chưa có user; bắt đổi mật khẩu; không tạo lần 2", async () => {
    await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123" });
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: "admin" },
      include: { roles: { include: { role: true } } },
    });
    expect(admin.mustChangePassword).toBe(true);
    expect(admin.passwordHash).not.toBe("Mat-khau-tam-123");
    expect(await bcrypt.compare("Mat-khau-tam-123", admin.passwordHash)).toBe(true);
    expect(bcrypt.getRounds(admin.passwordHash)).toBe(BCRYPT_COST); // không còn số 10 rời trong seed
    expect(admin.roles.map((r) => r.role.name)).toEqual(["Giám đốc"]);
    await seed(prisma, { bootstrapAdminPassword: "khac" });
    expect(await prisma.user.count()).toBe(1);
  });

  it("không có mật khẩu khởi tạo → không tạo user", async () => {
    await seed(prisma);
    expect(await prisma.user.count()).toBe(0);
  });

  it("mật khẩu rỗng → không tạo user", async () => {
    await seed(prisma, { bootstrapAdminPassword: "" });
    expect(await prisma.user.count()).toBe(0);
  });

  it("đã có user khác → không tạo admin dù có mật khẩu", async () => {
    await prisma.user.create({ data: { username: "nam", passwordHash: "x", fullName: "Nam" } });
    await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123" });
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.user.findUnique({ where: { username: "admin" } })).toBeNull();
  });

  it("không bao giờ in mật khẩu ra log", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123" });
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain("Mat-khau-tam-123");
  });

  it("tạo vai trò nguyên tử: lỗi giữa chừng khi gán quyền → không còn vai trò rỗng, lần seed sau tạo đủ", async () => {
    const crashing = new Proxy(prisma, {
      get(target, prop) {
        if (prop !== "$transaction") return Reflect.get(target, prop);
        return (fn: (tx: unknown) => Promise<unknown>, opts?: object) =>
          target.$transaction(
            (tx) =>
              fn(
                new Proxy(tx, {
                  get(t, p) {
                    if (p === "rolePermission") return { createMany: () => Promise.reject(new Error("sập giữa chừng")) };
                    return Reflect.get(t, p);
                  },
                }),
              ),
            opts,
          );
      },
    }) as typeof prisma;
    await expect(seed(crashing)).rejects.toThrow("sập giữa chừng");
    expect(await prisma.role.count()).toBe(0);
    expect(await prisma.rolePermission.count()).toBe(0);

    await seed(prisma);
    const gd = await prisma.role.findUniqueOrThrow({ where: { name: "Giám đốc" } });
    expect(await prisma.rolePermission.count({ where: { roleId: gd.id } })).toBe(PERMISSIONS.length);
  });

  it("tạo admin nguyên tử: lỗi khi gán vai trò → không còn user mồ côi, lần seed sau tạo được", async () => {
    await seed(prisma);
    const crashing = new Proxy(prisma, {
      get(target, prop) {
        if (prop !== "$transaction") return Reflect.get(target, prop);
        return (fn: (tx: unknown) => Promise<unknown>, opts?: object) =>
          target.$transaction(
            (tx) =>
              fn(
                new Proxy(tx, {
                  get(t, p) {
                    if (p === "user") return { ...t.user, create: () => Promise.reject(new Error("sập tạo admin")) };
                    return Reflect.get(t, p);
                  },
                }),
              ),
            opts,
          );
      },
    }) as typeof prisma;
    await expect(seed(crashing, { bootstrapAdminPassword: "Mat-khau-tam-123" })).rejects.toThrow("sập tạo admin");
    expect(await prisma.user.count()).toBe(0);
    await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123" });
    expect(await prisma.user.count()).toBe(1);
  });
});

describe("quyền MỚI thêm vào danh mục ở bản sau (seed chạy lại)", () => {
  const holders = async (code: string) =>
    (await prisma.rolePermission.findMany({ where: { permission: { code } }, include: { role: true } })).map((r) => r.role.name).sort();

  /** Mô phỏng "bản trước chưa có quyền này": xoá dòng Permission (kéo theo role_permissions do onDelete Cascade). */
  async function forgetPermission(code: string) {
    await prisma.permission.delete({ where: { code } });
  }

  it("quyền mới tạo → tự cấp cho vai trò wildcard (Giám đốc) đã tồn tại; vai trò khác KHÔNG được cấp", async () => {
    await seed(prisma);
    expect(await holders("cost.view")).toContain("Kế toán"); // mặc định ban đầu
    await forgetPermission("cost.view");
    await seed(prisma);
    expect(await prisma.permission.count({ where: { code: "cost.view" } })).toBe(1);
    expect(await holders("cost.view")).toEqual(["Giám đốc"]); // Kế toán (đã tồn tại) không bị áp lại mặc định
  });

  it("catalog mở rộng (tham số catalog): quyền mới chỉ vào Giám đốc", async () => {
    await seed(prisma);
    const extended = [...PERMISSIONS, { code: "zz.moi", label: "Quyền mới", group: "Thử nghiệm" }];
    await seed(prisma, { catalog: extended });
    expect(await holders("zz.moi")).toEqual(["Giám đốc"]);
    expect(await prisma.permission.count()).toBe(PERMISSIONS.length + 1);
  });

  it("vai trò MỚI tạo vẫn nhận mặc định của nó (Giám đốc: toàn bộ catalog kể cả quyền mới; Thủ kho: theo danh sách)", async () => {
    const extended = [...PERMISSIONS, { code: "zz.moi", label: "Quyền mới", group: "Thử nghiệm" }];
    await seed(prisma, { catalog: extended });
    expect(await holders("zz.moi")).toEqual(["Giám đốc"]);
    const gd = await prisma.role.findUniqueOrThrow({ where: { name: "Giám đốc" } });
    expect(await prisma.rolePermission.count({ where: { roleId: gd.id } })).toBe(PERMISSIONS.length + 1);
    expect(await holders("stock.view")).toContain("Thủ kho");
  });

  it("khách CHỦ ĐỘNG gỡ quyền đã tồn tại khỏi Giám đốc → seed lại KHÔNG cấp lại", async () => {
    await seed(prisma);
    const gd = await prisma.role.findUniqueOrThrow({ where: { name: "Giám đốc" } });
    await prisma.rolePermission.deleteMany({ where: { roleId: gd.id, permission: { code: "order.cancel" } } });
    await seed(prisma);
    await seed(prisma, { catalog: [...PERMISSIONS, { code: "zz.moi", label: "Quyền mới", group: "Thử nghiệm" }] });
    expect(await holders("order.cancel")).not.toContain("Giám đốc");
    expect(await holders("zz.moi")).toEqual(["Giám đốc"]); // quyền mới thì vẫn vào
  });

  it("idempotent: chạy lại lần nữa không thêm/bớt gì", async () => {
    await seed(prisma);
    await forgetPermission("cost.view");
    await seed(prisma);
    const before = JSON.stringify(await prisma.rolePermission.findMany({ orderBy: [{ roleId: "asc" }, { permissionId: "asc" }] }));
    await seed(prisma);
    await seed(prisma);
    expect(JSON.stringify(await prisma.rolePermission.findMany({ orderBy: [{ roleId: "asc" }, { permissionId: "asc" }] }))).toBe(before);
    expect(await prisma.permission.count()).toBe(PERMISSIONS.length);
  });

  it("nguyên tử: lỗi khi cấp quyền mới → quyền KHÔNG còn nửa vời (rollback), lần seed sau sửa đủ", async () => {
    await seed(prisma);
    await forgetPermission("cost.view");
    const crashing = new Proxy(prisma, {
      get(target, prop) {
        if (prop !== "$transaction") return Reflect.get(target, prop);
        return (fn: (tx: unknown) => Promise<unknown>, opts?: object) =>
          target.$transaction(
            (tx) =>
              fn(
                new Proxy(tx, {
                  get(t, p) {
                    if (p === "rolePermission") return { ...t.rolePermission, createMany: () => Promise.reject(new Error("sập khi cấp")) };
                    return Reflect.get(t, p);
                  },
                }),
              ),
            opts,
          );
      },
    }) as typeof prisma;
    await expect(seed(crashing)).rejects.toThrow("sập khi cấp");
    expect(await prisma.permission.count({ where: { code: "cost.view" } })).toBe(0); // rollback cả dòng Permission
    await seed(prisma);
    expect(await holders("cost.view")).toEqual(["Giám đốc"]);
  });

  it("tích hợp: Giám đốc (loadActor từ DB) cấp được quyền mới cho nhóm khác qua updateRolePermissions — không 403", async () => {
    await seed(prisma);
    await forgetPermission("cost.view");
    await seed(prisma);
    const gd = await prisma.role.findUniqueOrThrow({ where: { name: "Giám đốc" } });
    const boss = await prisma.user.create({ data: { username: "boss", fullName: "Boss", passwordHash: "x", roles: { create: { roleId: gd.id } } } });
    const actor = (await loadActor(prisma, boss.id))!;
    expect(actor.perms.has("cost.view")).toBe(true);
    const kho = await prisma.role.findUniqueOrThrow({ where: { name: "Thủ kho" }, include: { permissions: { include: { permission: true } } } });
    const codes = [...kho.permissions.map((p) => p.permission.code), "cost.view"];
    await prisma.$transaction((tx) => updateRolePermissions(tx, actor, kho.id, codes));
    expect(await holders("cost.view")).toEqual(["Giám đốc", "Thủ kho"]);
  });
});

describe("BOOTSTRAP_ADMIN_EMAIL (chỉ khi TẠO admin) + hạn mật khẩu khởi tạo", () => {
  const counts = async () => JSON.stringify(await Promise.all([
    prisma.user.count(), prisma.permission.count(), prisma.role.count(), prisma.rolePermission.count(),
    prisma.companySetting.count(), prisma.period.count(), prisma.auditLog.count(),
  ]));

  it("tạo admin kèm email (chuẩn hoá) + emailChangedAt + hạn mật khẩu tạm 72 giờ; seed lần 2 → cùng số dòng", async () => {
    await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123", bootstrapAdminEmail: "  Boss@Example.TEST " });
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    expect(admin.email).toBe("boss@example.test");
    expect(admin.emailChangedAt).not.toBeNull();
    expect(Math.abs(admin.tempPasswordExpiresAt!.getTime() - (Date.now() + 72 * 3600_000))).toBeLessThan(60_000);
    const before = await counts();
    await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123", bootstrapAdminEmail: "  Boss@Example.TEST " });
    expect(await counts()).toBe(before);
  });

  it("admin ĐÃ tồn tại với email NULL (vd quản trị viên đã gỡ) → seed KHÔNG gán/khôi phục", async () => {
    await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123", bootstrapAdminEmail: "boss@example.test" });
    await prisma.user.update({ where: { username: "admin" }, data: { email: null } }); // gỡ trên giao diện
    const before = await counts();
    await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123", bootstrapAdminEmail: "boss@example.test" });
    await seed(prisma, { bootstrapAdminEmail: "boss@example.test" });
    expect((await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).email).toBeNull();
    expect(await counts()).toBe(before);
  });

  it("KHÔNG ghi đè email đã có", async () => {
    await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123", bootstrapAdminEmail: "old@example.test" });
    await prisma.user.update({ where: { username: "admin" }, data: { email: "changed@example.test" } });
    await seed(prisma, { bootstrapAdminEmail: "old@example.test" });
    expect((await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).email).toBe("changed@example.test");
  });

  it("không có mật khẩu khởi tạo → không tạo admin, email bị bỏ qua; chuỗi rỗng → NULL", async () => {
    await seed(prisma, { bootstrapAdminEmail: "boss@example.test" });
    expect(await prisma.user.count()).toBe(0);
    await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123", bootstrapAdminEmail: "" });
    expect((await prisma.user.findUniqueOrThrow({ where: { username: "admin" } })).email).toBeNull();
  });

  it("email sai định dạng → seed dừng TRƯỚC mọi thao tác ghi", async () => {
    await expect(seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123", bootstrapAdminEmail: "khong-phai-email" }))
      .rejects.toThrow("BOOTSTRAP_ADMIN_EMAIL không phải email hợp lệ.");
    expect(await prisma.permission.count()).toBe(0);
    expect(await prisma.user.count()).toBe(0);
  });

  it("parseBootstrapEmail: chuẩn hoá; chỉ ASCII in được (như zod) — chặn dấu Kelvin, chữ có dấu, tab", () => {
    expect(parseBootstrapEmail(undefined)).toBeNull();
    expect(parseBootstrapEmail("  ")).toBeNull();
    expect(parseBootstrapEmail(" A@B.Test ")).toBe("a@b.test");
    expect(() => parseBootstrapEmail("a@b")).toThrow();
    for (const bad of ["Kim@example.test", "nguyễn@example.test", "\ta@example.test", "a@example.test\n"]) {
      expect(() => parseBootstrapEmail(bad)).toThrow("BOOTSTRAP_ADMIN_EMAIL không phải email hợp lệ.");
    }
  });
});
