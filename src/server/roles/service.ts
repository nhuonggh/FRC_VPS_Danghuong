import { Prisma } from "@prisma/client";
import { ALL_PERMISSION_CODES } from "@/lib/permissions/catalog";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { assertAdminRemains, lockAdminInvariant } from "@/server/users/service";
import type { RoleInfoInput } from "./schemas";

/** MỌI hàm nhận `db` là transaction client và PHẢI chạy trong prisma.$transaction. */
type Db = Prisma.TransactionClient;

async function getRoleOrThrow(db: Db, id: number) {
  const r = await db.role.findUnique({ where: { id }, include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } } });
  if (!r) throw new DomainError("Không tìm thấy nhóm quyền.", 404);
  return r;
}

const sortedCodes = (r: { permissions: { permission: { code: string } }[] }) => r.permissions.map((p) => p.permission.code).sort();

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export async function createRole(db: Db, actor: Actor, input: RoleInfoInput) {
  assertCan(actor.perms, "role.manage");
  const name = input.name.trim();
  if (await db.role.findUnique({ where: { name } })) throw new DomainError("Tên nhóm quyền đã tồn tại.");
  let role;
  try {
    role = await db.role.create({ data: { name, description: input.description?.trim() || null } });
  } catch (e) {
    if (isUnique(e)) throw new DomainError("Tên nhóm quyền đã tồn tại."); // 2 yêu cầu đồng thời cùng tên
    throw e;
  }
  await writeAudit(db, { userId: actor.userId, action: "role.create", entity: "Role", entityId: role.id, after: { name, description: role.description } });
  return { id: role.id };
}

export async function updateRoleInfo(db: Db, actor: Actor, roleId: number, input: RoleInfoInput) {
  assertCan(actor.perms, "role.manage");
  const role = await getRoleOrThrow(db, roleId);
  const name = input.name.trim();
  if (role.isSystem && name !== role.name) throw new DomainError("Không đổi tên được nhóm hệ thống.");
  if (name !== role.name && (await db.role.findUnique({ where: { name } }))) throw new DomainError("Tên nhóm quyền đã tồn tại.");
  const description = input.description?.trim() || null;
  try {
    await db.role.update({ where: { id: roleId }, data: { name, description } });
  } catch (e) {
    if (isUnique(e)) throw new DomainError("Tên nhóm quyền đã tồn tại.");
    throw e;
  }
  await writeAudit(db, {
    userId: actor.userId, action: "role.update_info", entity: "Role", entityId: roleId,
    before: { name: role.name, description: role.description }, after: { name, description },
  });
}

export async function updateRolePermissions(db: Db, actor: Actor, roleId: number, codes: string[]) {
  assertCan(actor.perms, "role.manage");
  await lockAdminInvariant(db);
  const role = await getRoleOrThrow(db, roleId);
  const wanted = [...new Set(codes)];
  const known = new Set<string>(ALL_PERMISSION_CODES);
  const bad = wanted.filter((c) => !known.has(c));
  if (bad.length) throw new DomainError(`Mã quyền không hợp lệ: ${bad.join(", ")}.`, 400);

  const perms = await db.permission.findMany({ where: { code: { in: wanted } } });
  if (perms.length !== wanted.length) throw new DomainError("Mã quyền không hợp lệ.", 400); // chưa có trong DB (chưa seed)
  await db.rolePermission.deleteMany({ where: { roleId } });
  await db.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) });
  await assertAdminRemains(db);
  await writeAudit(db, {
    userId: actor.userId, action: "role.set_permissions", entity: "Role", entityId: roleId,
    before: { permissions: sortedCodes(role) }, after: { permissions: perms.map((p) => p.code).sort() },
  });
}

export async function deleteRole(db: Db, actor: Actor, roleId: number) {
  assertCan(actor.perms, "role.manage");
  const role = await getRoleOrThrow(db, roleId);
  if (role.isSystem) throw new DomainError("Không xóa được nhóm hệ thống.");
  // Nhóm còn người dùng không xóa được → không thể làm mất quản trị viên; nhóm trống không ai giữ quyền qua nó.
  if (role._count.users > 0) {
    throw new DomainError(`Nhóm quyền đang có ${role._count.users} người dùng — hãy chuyển họ sang nhóm khác trước.`);
  }
  await db.role.delete({ where: { id: roleId } });
  await writeAudit(db, { userId: actor.userId, action: "role.delete", entity: "Role", entityId: roleId, before: { name: role.name, permissions: sortedCodes(role) } });
}
