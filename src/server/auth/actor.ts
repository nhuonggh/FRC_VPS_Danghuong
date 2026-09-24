import type { PrismaClient } from "@prisma/client";

export interface SessionActor {
  userId: number;
  username: string;
  fullName: string;
  perms: ReadonlySet<string>;
  mustChangePassword: boolean;
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
  const perms = new Set(
    user.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.code)),
  );
  return {
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    perms,
    mustChangePassword: user.mustChangePassword,
  };
}
