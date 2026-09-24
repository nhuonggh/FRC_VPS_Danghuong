import type { PrismaClient } from "@prisma/client";
import { DomainError } from "@/server/http/errors";

export async function listRoles(db: PrismaClient) {
  const roles = await db.role.findMany({ orderBy: { id: "asc" }, include: { _count: { select: { users: true, permissions: true } } } });
  return roles.map((r) => ({ id: r.id, name: r.name, description: r.description, isSystem: r.isSystem, userCount: r._count.users, permissionCount: r._count.permissions }));
}

export async function getRole(db: PrismaClient, id: number) {
  const r = await db.role.findUnique({
    where: { id },
    include: {
      permissions: { include: { permission: true } },
      users: { include: { user: { select: { id: true, username: true, fullName: true, isLocked: true } } } },
    },
  });
  if (!r) throw new DomainError("Không tìm thấy nhóm quyền.", 404);
  return {
    id: r.id, name: r.name, description: r.description, isSystem: r.isSystem,
    permissionCodes: r.permissions.map((p) => p.permission.code),
    users: r.users.map((u) => u.user),
  };
}
