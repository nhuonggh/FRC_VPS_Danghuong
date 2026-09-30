import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";

// D9: scripts/backup.sh + scripts/restore-drill.sh chạy ở chế độ PG_DIRECT trên DB test (pg_dump/pg_restore/psql cục bộ).
const url = new URL(process.env.DATABASE_URL!);
const dbName = decodeURIComponent(url.pathname.slice(1));
const pgEnv = { ...process.env, PG_DIRECT: "1", PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: dbName, DB_NAME: dbName, DRILL_DB: "dherp_restore_drill_test" };
let dir: string;
const run = (script: string, env: Record<string, string> = {}, args: string[] = []) => spawnSync("bash", [join(process.cwd(), "scripts", script), ...args], { env: { ...pgEnv, BACKUP_DIR: dir, ...env }, encoding: "utf8" });
const okRun = (script: string, env: Record<string, string> = {}) => { const r = run(script, env); expect(r.status, `${script}: ${r.stdout}${r.stderr}`).toBe(0); return r; };
const dumps = () => readdirSync(dir).filter((f) => f.endsWith(".dump"));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "dherp-backup-"));
  await resetDb();
  await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123", bootstrapAdminEmail: "boss@example.test" });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("backup.sh", () => {
  it("tạo file .dump đọc được + checksum, không lộ mật khẩu ra log, cảnh báo khi chưa có OFFSITE_CMD", () => {
    const r = run("backup.sh");
    expect(r.status).toBe(0);
    expect(dumps()).toHaveLength(1);
    expect(existsSync(join(dir, `${dumps()[0]}.sha256`))).toBe(true);
    expect(r.stdout + r.stderr).not.toContain(pgEnv.PGPASSWORD);
    expect(r.stdout).toContain("chưa cấu hình OFFSITE_CMD");
    expect(existsSync(join(dir, "FAILED"))).toBe(false);
  });

  it("xoá bản cũ hơn KEEP_DAYS, giữ bản mới; không đụng file lạ", () => {
    const old = join(dir, "dherp_2026-01-01_0100.dump"); writeFileSync(old, "x"); writeFileSync(`${old}.sha256`, "x");
    const t = new Date(Date.now() - 20 * 86400_000); utimesSync(old, t, t); utimesSync(`${old}.sha256`, t, t);
    const other = join(dir, "ghi-chu.txt"); writeFileSync(other, "giữ"); utimesSync(other, t, t);
    okRun("backup.sh", { KEEP_DAYS: "14" });
    expect(existsSync(old)).toBe(false); expect(existsSync(`${old}.sha256`)).toBe(false);
    expect(existsSync(other)).toBe(true); expect(dumps()).toHaveLength(1);
  });

  it("lỗi → thoát ≠ 0, ghi FAILED, không để lại file dở; lần thành công sau xoá FAILED", () => {
    const bad = run("backup.sh", { PGDATABASE: "khong_ton_tai" });
    expect(bad.status).toBe(1);
    expect(readFileSync(join(dir, "FAILED"), "utf8")).toContain("pg_dump lỗi");
    expect(readdirSync(dir).filter((f) => f.endsWith(".part") || f.endsWith(".dump"))).toHaveLength(0);
    okRun("backup.sh");
    expect(existsSync(join(dir, "FAILED"))).toBe(false);
  });

  it("OFFSITE_CMD nhận BACKUP_FILE; lệnh lỗi → thất bại", () => {
    const copy = join(dir, "offsite"); mkdirSync(copy);
    expect(run("backup.sh", { OFFSITE_CMD: `cp "$BACKUP_FILE" "${copy}/"` }).status).toBe(0);
    expect(readdirSync(copy)).toHaveLength(1);
    const fail = run("backup.sh", { OFFSITE_CMD: "exit 3" });
    expect(fail.status).toBe(1); expect(readFileSync(join(dir, "FAILED"), "utf8")).toContain("OFFSITE_CMD");
  });
});

describe("restore-drill.sh", () => {
  it("khôi phục bản mới nhất ra DB tạm, số dòng khớp DB thật, xoá DB tạm sau khi xong", async () => {
    okRun("backup.sh");
    const r = run("restore-drill.sh");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("ĐẠT");
    const left = await prisma.$queryRawUnsafe<{ datname: string }[]>("SELECT datname FROM pg_database WHERE datname = 'dherp_restore_drill_test'");
    expect(left).toHaveLength(0);
  });

  it("phát hiện checksum sai và bản sao lưu nhiều hơn DB thật", async () => {
    okRun("backup.sh");
    await prisma.auditLog.create({ data: { action: "x.y", entity: "X" } });
    const before = await prisma.auditLog.count();
    okRun("backup.sh"); // bản 2 (cùng phút: ghi đè cùng tên — vẫn hợp lệ)
    await prisma.$executeRawUnsafe("ALTER TABLE audit_log DISABLE TRIGGER ALL");
    await prisma.$executeRawUnsafe("DELETE FROM audit_log");
    await prisma.$executeRawUnsafe("ALTER TABLE audit_log ENABLE TRIGGER ALL");
    expect(before).toBeGreaterThan(0);
    const r = run("restore-drill.sh");
    expect(r.status).toBe(6);
    expect(r.stdout).toContain("NHIỀU hơn");
    const f = join(dir, dumps()[0]!); writeFileSync(f, readFileSync(f).subarray(0, 100));
    expect(run("restore-drill.sh").status).toBe(3);
  });

  it("mục lục pg_restore rất lớn (> 64KB) vẫn nhận ra có dữ liệu bảng (không SIGPIPE với pipefail)", async () => {
    // Tạo nhiều bảng để mục lục dump vượt bộ đệm pipe 64KB; TABLE DATA xuất hiện ở cuối mục lục.
    for (let i = 0; i < 400; i++) await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS zz_big_toc_${i}_padding_padding_padding_padding (id int)`);
    try { okRun("backup.sh"); } finally { for (let i = 0; i < 400; i++) await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS zz_big_toc_${i}_padding_padding_padding_padding`); }
  });
});
