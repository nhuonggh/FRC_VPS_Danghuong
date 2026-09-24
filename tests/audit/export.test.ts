import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import { AUDIT_FILTER_KEYS } from "@/server/audit/queries";
import { EXPORT_CELL_MAX_CHARS, MAX_EXPORT_ROWS, exportAuditXlsx } from "@/server/audit/export";
import { prisma, resetDb } from "../helpers/db";

beforeEach(resetDb);

const params = (sp: Record<string, string> = {}) => parseListParams(sp, AUDIT_FILTER_KEYS);
const perms = (...p: string[]) => new Set(p);

async function sheetRows(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  const ws = wb.worksheets[0]!;
  const rows: Record<string, unknown>[] = [];
  const header = (ws.getRow(1).values as unknown[]).slice(1) as string[];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const vals = (row.values as unknown[]).slice(1);
    rows.push(Object.fromEntries(header.map((h, i) => [h, vals[i] ?? null])));
  });
  return { header, rows, ws };
}

describe("exportAuditXlsx", () => {
  it("cột: Thời gian (ICT), Người thao tác, Hành động, Đối tượng, Mã, Số cũ, Số mới", async () => {
    const u = await prisma.user.create({ data: { username: "nam", fullName: "Nguyễn Văn Nam", passwordHash: "x" } });
    await prisma.auditLog.create({
      data: { userId: u.id, action: "user.update", entity: "User", entityId: "00123", at: new Date("2026-09-30T16:50:00Z"), beforeJson: { fullName: "A" }, afterJson: { fullName: "B" } },
    });
    await prisma.auditLog.create({ data: { userId: null, action: "system.seed", entity: "System", at: new Date("2026-09-29T00:00:00Z") } });
    const r = await exportAuditXlsx(prisma, params(), perms("audit.view"));
    const { header, rows, ws } = await sheetRows(r.buffer);
    expect(header).toEqual(["Thời gian", "Người thao tác", "Hành động", "Đối tượng", "Mã", "Số cũ", "Số mới"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ "Thời gian": "23:50 30/09/2026", "Người thao tác": "Nguyễn Văn Nam", "Hành động": "user.update", "Mã": "00123", "Số cũ": '{"fullName":"A"}', "Số mới": '{"fullName":"B"}' });
    expect(rows[1]).toMatchObject({ "Người thao tác": "Hệ thống" });
    expect(ws.getColumn(5).numFmt).toBe("@"); // cột Mã là chữ: giữ số 0 đầu
    expect(r).toMatchObject({ rowCount: 2, truncated: false });
  });

  it("dùng ĐÚNG bộ lọc của trang (người, đối tượng, từ khóa, thời gian ICT)", async () => {
    const mk = (over: object) => prisma.auditLog.create({ data: { userId: 1, action: "a.b", entity: "E1", ...over } });
    await mk({ entityId: "keep", at: new Date("2026-09-30T16:59:00Z") });
    await mk({ entityId: "other-user", userId: 2, at: new Date("2026-09-30T16:59:00Z") });
    await mk({ entityId: "other-entity", entity: "E2", at: new Date("2026-09-30T16:59:00Z") });
    await mk({ entityId: "next-day", at: new Date("2026-09-30T17:00:00Z") });
    const now = new Date("2026-09-30T05:00:00Z");
    const r = await exportAuditXlsx(prisma, params({ user: "1", entity: "E1", timePreset: "today", q: "a.b" }), perms("audit.view"), { now });
    expect((await sheetRows(r.buffer)).rows.map((x) => x["Mã"])).toEqual(["keep"]);
  });

  it("REDACTION như trang chi tiết: thiếu cost.view → unitCost không có trong file; có cost.view → có", async () => {
    await prisma.auditLog.create({
      data: { action: "product.update", entity: "Product", beforeJson: { name: "A", unitCost: "90000", nested: { salePrice: "5" } }, afterJson: { name: "B", unitCost: "95000", nested: { salePrice: "6" } } },
    });
    const denied = await sheetRows((await exportAuditXlsx(prisma, params(), perms("audit.view"))).buffer);
    const text = JSON.stringify(denied.rows);
    expect(text).not.toMatch(/unitCost|salePrice|90000|95000/);
    expect(text).toContain('name'); // field không nhạy cảm vẫn còn
    const allowed = await sheetRows((await exportAuditXlsx(prisma, params(), perms("audit.view", "cost.view", "sale_price.view"))).buffer);
    expect(JSON.stringify(allowed.rows)).toMatch(/unitCost/);
    expect(JSON.stringify(allowed.rows)).toMatch(/salePrice/);
  });

  it("bí mật đã bị bỏ từ lúc ghi (writeAudit) — file không chứa mật khẩu", async () => {
    const { writeAudit } = await import("@/server/audit/write");
    await writeAudit(prisma, { userId: 1, action: "user.create", entity: "User", after: { username: "x", passwordHash: "$2b$secret", tempPassword: "Abc123" } });
    const text = JSON.stringify((await sheetRows((await exportAuditXlsx(prisma, params(), perms("audit.view"))).buffer)).rows);
    expect(text).not.toMatch(/secret|Abc123|passwordHash|tempPassword/);
  });

  it("chống công thức: ô bắt đầu bằng = + - @ được tiền tố dấu nháy", async () => {
    await prisma.auditLog.create({ data: { action: "=HYPERLINK(\"x\")", entity: "@E", entityId: "-1+1" } });
    const { rows } = await sheetRows((await exportAuditXlsx(prisma, params(), perms("audit.view"))).buffer);
    expect(String(rows[0]!["Hành động"]).startsWith("'=")).toBe(true);
    expect(String(rows[0]!["Đối tượng"]).startsWith("'@")).toBe(true);
    expect(String(rows[0]!["Mã"]).startsWith("'")).toBe(true);
  });

  it("giá trị JSON dài bị cắt dưới giới hạn ô của Excel (32.767 ký tự)", async () => {
    await prisma.auditLog.create({ data: { action: "a", entity: "E", afterJson: { blob: "z".repeat(EXPORT_CELL_MAX_CHARS * 2) } } });
    const { rows } = await sheetRows((await exportAuditXlsx(prisma, params(), perms("audit.view"))).buffer);
    const cell = String(rows[0]!["Số mới"]);
    expect(cell.length).toBeLessThanOrEqual(EXPORT_CELL_MAX_CHARS + 1);
    expect(cell.endsWith("…")).toBe(true);
    expect(EXPORT_CELL_MAX_CHARS).toBeLessThan(32767);
  });

  it("vượt giới hạn dòng: chỉ xuất dòng MỚI NHẤT, thêm dòng ghi chú rõ ràng, truncated = true", async () => {
    for (let i = 1; i <= 5; i++) await prisma.auditLog.create({ data: { action: "a", entity: "E", entityId: String(i), at: new Date(Date.UTC(2026, 8, i)) } });
    const r = await exportAuditXlsx(prisma, params(), perms("audit.view"), { maxRows: 3 });
    const { rows } = await sheetRows(r.buffer);
    expect(r).toMatchObject({ truncated: true, rowCount: 3 });
    expect(rows.slice(0, 3).map((x) => x["Mã"])).toEqual(["5", "4", "3"]);
    expect(rows).toHaveLength(4);
    expect(String(rows[3]!["Hành động"])).toMatch(/chỉ xuất 3 dòng mới nhất/i);
    expect(String(rows[3]!["Hành động"])).toMatch(/thu hẹp bộ lọc/i);
  });

  it("đúng bằng giới hạn: không cắt, không dòng ghi chú", async () => {
    for (let i = 1; i <= 3; i++) await prisma.auditLog.create({ data: { action: "a", entity: "E", entityId: String(i) } });
    const r = await exportAuditXlsx(prisma, params(), perms("audit.view"), { maxRows: 3 });
    expect(r).toMatchObject({ truncated: false, rowCount: 3 });
    expect((await sheetRows(r.buffer)).rows).toHaveLength(3);
  });

  it("giới hạn mặc định là 50.000 dòng", () => {
    expect(MAX_EXPORT_ROWS).toBe(50_000);
  });
});
