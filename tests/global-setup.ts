import { execSync } from "node:child_process";
import "./setup-env"; // nạp .env.test TRƯỚC khi @prisma/client được import
import { PrismaClient } from "@prisma/client";
import { assertTestDatabaseUrls } from "./helpers/assert-test-db";

export default async function setup() {
  // Chốt an toàn: không bao giờ DROP SCHEMA trên DB không phải DB test (kiểm cả 2 URL)
  assertTestDatabaseUrls();
  const url = process.env.MIGRATE_DATABASE_URL!;

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    await prisma.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
    await prisma.$executeRawUnsafe("CREATE SCHEMA public");
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
          CREATE ROLE app_rw LOGIN PASSWORD 'app_rw_test';
        END IF;
      END $$;
    `);
  } finally {
    await prisma.$disconnect();
  }

  // Im lặng khi thành công (giữ output test sạch); khi lỗi in nguyên văn stdout/stderr của Prisma
  try {
    execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env } });
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `prisma migrate deploy thất bại:\n${err.stdout?.toString() ?? ""}\n${err.stderr?.toString() ?? ""}`,
    );
  }
}
