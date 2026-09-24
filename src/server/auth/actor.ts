import type { PrismaClient } from "@prisma/client";

export interface SessionActor {
  userId: number;
  username: string;
  fullName: string;
  perms: ReadonlySet<string>;
  mustChangePassword: boolean;
}

/** Hình dạng tối thiểu của một nhóm quyền kèm danh sách quyền (đúng shape của Prisma include). */
export interface RoleWithPermissions {
  permissions: { permission: { code: string } }[];
}

/**
 * NGUỒN DUY NHẤT của "quyền hiệu lực" = HỢP quyền của mọi nhóm. Dùng cho loadActor và kiểm tra leo thang đặc quyền
 * (@/server/users/privilege). (assertAdminRemains đếm bằng SQL cùng ngữ nghĩa: có ≥ 1 nhóm mang user.manage.)
 */
export function unionPermissionCodes(roles: readonly RoleWithPermissions[]): Set<string> {
  return new Set(roles.flatMap((r) => r.permissions.map((rp) => rp.permission.code)));
}

/**
 * Đọc user + quyền từ DB mỗi request: khoá tài khoản / đổi quyền có hiệu lực ngay.
 * Quyền = HỢP của mọi vai trò của user. Tài khoản không tồn tại hoặc bị khoá → null.
 */
export async function loadActor(prisma: PrismaClient, userId: number): Promise<SessionActor | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  if (!user || user.isLocked) return null;
  const perms = unionPermissionCodes(user.roles.map((ur) => ur.role));
  return {
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    perms,
    mustChangePassword: user.mustChangePassword,
  };
}
