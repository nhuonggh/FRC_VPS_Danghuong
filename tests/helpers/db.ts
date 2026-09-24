import "../setup-env";
import { PrismaClient } from "@prisma/client";
import { assertTestDatabaseUrls } from "./assert-test-db";

// Chặn ngay khi nạp module: không tạo client nào trỏ vào DB không phải DB test
assertTestDatabaseUrls();

export const prisma = new PrismaClient();

/** Xoá sạch dữ liệu mọi bảng (trừ _prisma_migrations), reset id. */
export async function resetDb() {
  assertTestDatabaseUrls(); // lặp lại ngay trước lệnh phá huỷ (env có thể bị đổi giữa chừng)
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$transaction([
    prisma.$executeRawUnsafe("ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_truncate"),
    prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`),
    prisma.$executeRawUnsafe("ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_truncate"),
  ]);
}
