// Cấu hình Prisma CLI. Đặt migrations ở prisma/migrations (mặc định của schema dạng thư mục
// sẽ là prisma/schema/migrations). Khi có file này Prisma không tự nạp .env nữa → nạp thủ công
// (không ghi đè biến đã có: CI/test truyền env trực tiếp).
try {
  process.loadEnvFile(".env");
} catch {
  // không có .env (CI, Docker) — bỏ qua
}

const config = {
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
};

export default config;
