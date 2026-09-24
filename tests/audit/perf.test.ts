import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import { exportAuditXlsx } from "@/server/audit/export";
import { AUDIT_FILTER_KEYS, listAudit, listAuditEntities } from "@/server/audit/queries";
import { prisma, resetDb } from "../helpers/db";

/**
 * HỢP ĐỒNG HIỆU NĂNG (Review Focus plan 01c): 50.000 dòng nhật ký vẫn phân trang ≤ 3 giây.
 * Ngưỡng 3.000 ms là ngưỡng thật (không nới cho CI); đo cả trang + đếm tổng (listAudit chạy 2 truy vấn song song).
 * Đặt PERF_LOG=1 để in thời gian đo được.
 */
const BUDGET_MS = 3000;
const params = (sp: Record<string, string> = {}) => parseListParams(sp, AUDIT_FILTER_KEYS);
const NOW = new Date();
const timings: string[] = [];

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = performance.now();
  const r = await fn();
  const ms = performance.now() - t;
  timings.push(`${label}: ${ms.toFixed(0)} ms`);
  expect(ms, label).toBeLessThan(BUDGET_MS);
  return r;
}

beforeAll(async () => {
  await resetDb();
  // INSERT thường (trigger append-only chỉ chặn UPDATE/DELETE/TRUNCATE). 5 người × 8 đối tượng, có payload JSON như thật.
  await prisma.$executeRawUnsafe(`
    INSERT INTO audit_log ("userId", action, entity, "entityId", "beforeJson", "afterJson", "ip", "at")
    SELECT 1 + (g % 5), 'order.update', 'Entity' || (g % 8), g::text,
           jsonb_build_object('qty', g, 'unitCost', g * 10, 'note', repeat('x', 200)),
           jsonb_build_object('qty', g + 1, 'unitCost', g * 10 + 5, 'note', repeat('y', 200)),
           '10.0.0.1', now() - (g || ' seconds')::interval
    FROM generate_series(1, 50000) g`);
  await prisma.$executeRawUnsafe("ANALYZE audit_log");
}, 120_000);

afterAll(async () => {
  if (process.env.PERF_LOG) console.info(`[audit perf @50.000 dòng]\n  ${timings.join("\n  ")}`);
  await resetDb();
});

describe("nhật ký 50.000 dòng", () => {
  it("trang đầu, trang giữa, trang xa, trang cuối: ≤ 3 giây và đủ tổng", async () => {
    for (const page of ["1", "500", "2000", "2500"]) {
      const r = await timed(`trang ${page}`, () => listAudit(prisma, params({ page }), NOW));
      expect(r.total).toBe(50000);
      expect(r.rows.length).toBe(20);
    }
    const beyond = await timed("trang ngoài cùng (rỗng)", () => listAudit(prisma, params({ page: "999999" }), NOW));
    expect(beyond.rows).toEqual([]);
  }, 60_000);

  it("pageSize 100, trang cuối", async () => {
    const r = await timed("100/trang, trang 500", () => listAudit(prisma, params({ pageSize: "100", page: "500" }), NOW));
    expect(r.rows).toHaveLength(100);
  }, 60_000);

  it("lọc người thao tác + đối tượng + thời gian + từ khóa, trang xa", async () => {
    const r1 = await timed("lọc người", () => listAudit(prisma, params({ user: "1,2" }), NOW));
    expect(r1.total).toBe(20000);
    const r2 = await timed("lọc đối tượng", () => listAudit(prisma, params({ entity: "Entity3", page: "300" }), NOW));
    expect(r2.total).toBe(6250);
    const r3 = await timed("lọc thời gian (Hôm nay)", () => listAudit(prisma, params({ timePreset: "today" }), NOW));
    expect(r3.total).toBeGreaterThan(0);
    const r4 = await timed("lọc thời gian (Năm nay) trang 100", () => listAudit(prisma, params({ timePreset: "thisYear", page: "100" }), NOW));
    expect(r4.total).toBeGreaterThan(0); // (= 50.000 trừ khi chạy đúng những giây đầu năm mới)
    const r5 = await timed("từ khóa 'update'", () => listAudit(prisma, params({ q: "update", page: "50" }), NOW));
    expect(r5.total).toBe(50000);
    const r6 = await timed("từ khóa mã '4999'", () => listAudit(prisma, params({ q: "4999" }), NOW));
    expect(r6.total).toBeGreaterThan(0);
  }, 60_000);

  it("sắp xếp theo cột khác (action/entity/thời gian tăng dần), trang xa", async () => {
    for (const sort of ["action", "-entity", "at"]) {
      const r = await timed(`sort ${sort}`, () => listAudit(prisma, params({ sort, page: "1500" }), NOW));
      expect(r.rows).toHaveLength(20);
    }
  }, 60_000);

  it("danh sách đối tượng cho bộ lọc (GROUP BY trên 50.000 dòng)", async () => {
    const list = await timed("listAuditEntities", () => listAuditEntities(prisma));
    expect(list).toHaveLength(8);
  });

  it("xuất Excel toàn bộ 50.000 dòng (đúng giới hạn) hoàn tất trong 30 giây", async () => {
    const t = performance.now();
    const r = await exportAuditXlsx(prisma, params(), new Set(["audit.view"]));
    const ms = performance.now() - t;
    timings.push(`xuất Excel 50.000 dòng: ${ms.toFixed(0)} ms (${(r.buffer.length / 1024 / 1024).toFixed(1)} MB)`);
    expect(r).toMatchObject({ rowCount: 50000, truncated: false });
    expect(ms).toBeLessThan(30_000);
  }, 120_000);
});
