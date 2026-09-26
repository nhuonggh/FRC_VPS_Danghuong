-- Fix round 1 (review bảo mật đăng nhập Google):
--  * tempPasswordExpiresAt: mật khẩu tạm có hạn (72 giờ, TEMP_PASSWORD_TTL_HOURS) — người chỉ dùng Google không để lại
--    một mật khẩu tạm dùng được mãi mãi.
--  * emailChangedAt: đổi/gỡ email làm hết hiệu lực phiên Google đang mở (so với authAt trong JWT).
-- Tên cột camelCase theo quy ước sẵn có của bảng users ("passwordHash", "mustChangePassword").

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailChangedAt" TIMESTAMPTZ(3),
ADD COLUMN     "tempPasswordExpiresAt" TIMESTAMPTZ(3);

-- Backfill: mật khẩu tạm ĐANG tồn tại (tài khoản chờ đổi mật khẩu) cũng có hạn, tính từ lúc migrate.
UPDATE "users" SET "tempPasswordExpiresAt" = now() + interval '72 hours' WHERE "mustChangePassword" = true;

-- Quyền app_rw: GRANT mức bảng (migration foundation) phủ cả cột mới.
