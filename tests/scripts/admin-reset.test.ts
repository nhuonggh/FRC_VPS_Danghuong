import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";
import { adminResetPassword } from "../../prisma/admin-reset-lib";
import { seed } from "../../prisma/seed-lib";
import { verifyCredentials } from "@/server/auth/credentials";
import { prisma, resetDb } from "../helpers/db";

const NEW = "CuuHo2026xyz"; // giá trị giả

beforeEach(async () => {
  await resetDb();
  await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123", bootstrapAdminEmail: "boss@example.test" });
  // Tình huống cứu hộ: mật khẩu tạm của admin đã hết hạn
  await prisma.user.update({ where: { username: "admin" }, data: { tempPasswordExpiresAt: new Date(Date.now() - 1000) } });
});

describe("adminResetPassword (npm run admin:reset)", () => {
  it("mật khẩu tạm hết hạn → không vào được; sau cứu hộ vào được bằng mật khẩu mới, bắt đổi, hạn 72 giờ, audit hệ thống", async () => {
    expect((await verifyCredentials(prisma, "admin", "Mat-khau-tam-123")).ok).toBe(false);
    const r = await adminResetPassword(prisma, { newPassword: NEW });
    expect(r).toEqual({ username: "admin", expiresInHours: 72, isLocked: false });
    expect((await verifyCredentials(prisma, "admin", NEW)).ok).toBe(true);
    expect((await verifyCredentials(prisma, "admin", "Mat-khau-tam-123")).ok).toBe(false);
    const u = await prisma.user.findUniqueOrThrow({ where: { username: "admin" } });
    expect(u.mustChangePassword).toBe(true);
    expect(Math.abs(u.tempPasswordExpiresAt!.getTime() - (Date.now() + 72 * 3600_000))).toBeLessThan(60_000);
    expect(u.email).toBe("boss@example.test"); // không đụng email/khoá/vai trò
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "user.reset_password" } });
    expect(log).toMatchObject({ userId: null, entityId: String(u.id), afterJson: { via: "admin:reset" } });
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain(NEW);
  });

  it("thiếu / yếu / không có tài khoản → lỗi, không đổi gì", async () => {
    const before = JSON.stringify(await prisma.user.findMany());
    await expect(adminResetPassword(prisma, { newPassword: undefined })).rejects.toThrow("Thiếu NEW_ADMIN_PASSWORD.");
    await expect(adminResetPassword(prisma, { newPassword: "ngan" })).rejects.toThrow(/NEW_ADMIN_PASSWORD không đạt/);
    await expect(adminResetPassword(prisma, { newPassword: NEW, username: "khongco" })).rejects.toThrow(/Không có tài khoản/);
    expect(JSON.stringify(await prisma.user.findMany())).toBe(before);
    expect(await prisma.auditLog.count({ where: { action: "user.reset_password" } })).toBe(0);
  });

  it("script thật (tsx scripts/admin-reset.ts): chạy được, KHÔNG in mật khẩu ra stdout/stderr", () => {
    const res = spawnSync("npx", ["tsx", "scripts/admin-reset.ts"], {
      env: { ...process.env, NEW_ADMIN_PASSWORD: NEW, MIGRATE_DATABASE_URL: process.env.MIGRATE_DATABASE_URL },
      encoding: "utf8", shell: process.platform === "win32", timeout: 60_000,
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Đã đặt mật khẩu tạm mới cho 'admin'");
    expect(`${res.stdout}${res.stderr}`).not.toContain(NEW);
    expect(`${res.stdout}${res.stderr}`).not.toMatch(/postgres(ql)?:\/\//);
  }, 90_000);

  it("script thiếu NEW_ADMIN_PASSWORD → mã thoát ≠ 0, thông báo ngắn", () => {
    const env = { ...process.env };
    delete env.NEW_ADMIN_PASSWORD;
    const res = spawnSync("npx", ["tsx", "scripts/admin-reset.ts"], { env, encoding: "utf8", shell: process.platform === "win32", timeout: 60_000 });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("Thiếu NEW_ADMIN_PASSWORD.");
  }, 90_000);
});
