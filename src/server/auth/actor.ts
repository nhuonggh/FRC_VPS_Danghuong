import type { PrismaClient } from "@prisma/client";
import type { AuthMethod } from "./google";

export interface SessionActor {
  userId: number;
  username: string;
  fullName: string;
  perms: ReadonlySet<string>;
  /**
   * Bắt đổi mật khẩu CÓ HIỆU LỰC cho phiên này (không phải cờ thô trong DB): chỉ áp cho phiên đăng nhập bằng
   * mật khẩu. Phiên Google đã được Google chứng minh danh tính → không bắt đổi (xem mustChangePasswordApplies).
   */
  mustChangePassword: boolean;
  /** Cách phiên được xác thực (JWT `amr`). Thiếu → "password" (phiên cũ trước khi có Google). */
  authMethod: AuthMethod;
}

/**
 * Chính sách "bắt đổi mật khẩu": chỉ phiên mật khẩu. Người vào bằng Google có thể không có/không biết mật khẩu
 * (mật khẩu tạm do admin cấp) — bắt họ đổi sẽ khoá họ ngoài hệ thống mà không tăng an toàn.
 */
export const mustChangePasswordApplies = (flag: boolean, authMethod: AuthMethod): boolean =>
  flag && authMethod === "password";

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
export async function loadActor(
  prisma: PrismaClient,
  userId: number,
  authMethod: AuthMethod = "password",
): Promise<SessionActor | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  if (!user || user.isLocked) return null;
  // Phiên Google mà quản trị viên đã GỠ email (thu hồi đăng nhập Google) → hết hiệu lực ngay ở request kế tiếp
  if (authMethod === "google" && !user.email) return null;
  const perms = unionPermissionCodes(user.roles.map((ur) => ur.role));
  return {
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    perms,
    mustChangePassword: mustChangePasswordApplies(user.mustChangePassword, authMethod),
    authMethod,
  };
}
