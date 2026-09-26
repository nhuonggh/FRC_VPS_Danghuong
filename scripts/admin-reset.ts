// Cứu hộ tài khoản quản trị (RUNBOOK mục 13): `npm run admin:reset` (dev) hoặc trong image migrator:
//   npx tsx scripts/admin-reset.ts
// Env: MIGRATE_DATABASE_URL (owner; fallback DATABASE_URL), NEW_ADMIN_PASSWORD (bắt buộc, KHÔNG in ra),
//      ADMIN_USERNAME (tuỳ chọn, mặc định "admin").
import { PrismaClient } from "@prisma/client";
import { adminResetPassword } from "../prisma/admin-reset-lib";

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Thiếu MIGRATE_DATABASE_URL.");
  process.exit(1);
}
const prisma = new PrismaClient({ datasources: { db: { url } } });

adminResetPassword(prisma, { newPassword: process.env.NEW_ADMIN_PASSWORD, username: process.env.ADMIN_USERNAME })
  .then((r) => {
    console.log(`Đã đặt mật khẩu tạm mới cho '${r.username}' (bắt đổi ở lần đăng nhập đầu, hết hạn sau ${r.expiresInHours} giờ).`);
    if (r.isLocked) console.log(`CHÚ Ý: '${r.username}' đang bị KHOÁ — mở khoá bằng một quản trị viên khác trước khi đăng nhập.`);
  })
  .catch((e: unknown) => {
    // Chỉ in thông điệp (đã là tiếng Việt, không chứa mật khẩu) — không in stack/đối tượng lỗi có thể mang URL DB
    console.error(e instanceof Error ? e.message : "Lỗi không xác định.");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
