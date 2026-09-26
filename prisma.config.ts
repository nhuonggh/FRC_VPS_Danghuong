// Cấu hình Prisma CLI. Đặt migrations ở prisma/migrations (mặc định của schema dạng thư mục
// sẽ là prisma/schema/migrations). Khi có file này Prisma không tự nạp .env nữa → nạp thủ công
// (không ghi đè biến đã có: CI/test truyền env trực tiếp).
try {
  process.loadEnvFile(".env");
} catch {
  // không có .env (CI, Docker) — bỏ qua
}

// Image migrator trên VPS chỉ nhận ~/app/.env.migrate (MIGRATE_DATABASE_URL, không có DATABASE_URL của app):
// schema đòi env("DATABASE_URL") nên dùng URL owner cho cả migrate lẫn seed (tiến trình seed kế thừa env này).
// Chỉ điền khi THIẾU — dev/test đã đặt DATABASE_URL thì giữ nguyên.
if (!process.env.DATABASE_URL && process.env.MIGRATE_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.MIGRATE_DATABASE_URL;
}

const config = {
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
};

export default config;
