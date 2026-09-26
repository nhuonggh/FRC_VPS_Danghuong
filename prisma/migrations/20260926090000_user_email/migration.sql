-- Đăng nhập Google (thay D-1: Credentials + Google). Email là khoá khớp DUY NHẤT giữa tài khoản Google và user:
-- chỉ quản trị (user.manage) đặt được; không bao giờ tự tạo user từ Google.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "email" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- SQL THÔ — Prisma không mô hình được CHECK.
-- Email lưu đã chuẩn hoá (chữ thường, không khoảng trắng, không rỗng) → UNIQUE ở trên cũng chặn trùng không phân biệt
-- hoa/thường. Ứng dụng chuẩn hoá trước khi ghi (normalizeEmail). btrim() mặc định chỉ cắt dấu cách → thêm điều kiện
-- "không có ký tự trắng nào" ([[:space:]]: tab, xuống dòng…) — email hợp lệ không bao giờ chứa khoảng trắng.
ALTER TABLE users ADD CONSTRAINT users_email_normalized_chk
  CHECK (email = lower(email) AND email = btrim(email) AND email <> '' AND email !~ '[[:space:]]');

-- Quyền app_rw: GRANT ở mức BẢNG (migration foundation) đã phủ mọi cột, kể cả cột thêm sau — không cần GRANT mới.
