import type { PrismaClient } from "@prisma/client";
// KHÔNG import zod/alias "@/": chạy trong image migrator (chỉ prisma + @prisma/client + tsx + bcryptjs)
import { normalizeUsername } from "../src/server/auth/normalize";
import { TEMP_PASSWORD_TTL_HOURS, hashPassword, tempPasswordExpiry, validatePasswordStrength } from "../src/server/auth/password";

export interface AdminResetResult {
  username: string;
  expiresInHours: number;
  isLocked: boolean;
}

/**
 * CỨU HỘ (RUNBOOK mục 13): đặt mật khẩu TẠM mới cho một tài khoản (mặc định `admin`) khi không còn ai đăng nhập được
 * (Google không dùng được + mật khẩu tạm đã hết hạn). Chạy bằng owner DB trong image migrator, KHÔNG qua giao diện.
 * - Mật khẩu lấy từ tham số (script đọc env NEW_ADMIN_PASSWORD) — không bao giờ in ra.
 * - Đặt mustChangePassword = true + hạn TEMP_PASSWORD_TTL_HOURS; KHÔNG đổi khoá, email, vai trò.
 * - Ghi audit `user.reset_password` (người thực hiện: hệ thống, `via: "admin:reset"`), cùng transaction.
 */
export async function adminResetPassword(
  prisma: PrismaClient,
  opts: { newPassword: string | undefined; username?: string },
): Promise<AdminResetResult> {
  const username = normalizeUsername(opts.username || "admin");
  const newPassword = opts.newPassword ?? "";
  if (!newPassword) throw new Error("Thiếu NEW_ADMIN_PASSWORD.");
  const weak = validatePasswordStrength(newPassword, username);
  if (weak) throw new Error(`NEW_ADMIN_PASSWORD không đạt: ${weak}`);
  const passwordHash = await hashPassword(newPassword);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { username }, select: { id: true, isLocked: true } });
    if (!user) throw new Error(`Không có tài khoản '${username}'.`);
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: true, tempPasswordExpiresAt: tempPasswordExpiry() },
    });
    await tx.auditLog.create({
      data: { userId: null, action: "user.reset_password", entity: "User", entityId: String(user.id), afterJson: { via: "admin:reset" } },
    });
    return { username, expiresInHours: TEMP_PASSWORD_TTL_HOURS, isLocked: user.isLocked };
  });
}
