import { beforeEach, describe, expect, it } from "vitest";
import { parseListParams } from "@/lib/query-params";
import {
  AUDIT_FILTER_KEYS, MAX_CHANGES, getAuditEntry, listAudit, listAuditEntities, toAuditDetail,
} from "@/server/audit/queries";
import { prisma, resetDb } from "../helpers/db";

beforeEach(resetDb);

async function log(over: Partial<{ userId: number; action: string; entity: string; entityId: string; at: Date }> = {}) {
  return prisma.auditLog.create({ data: { userId: 1, action: "order.update", entity: "SaleOrder", entityId: "1", ...over } });
}
const params = (sp: Record<string, string> = {}) => parseListParams(sp, AUDIT_FILTER_KEYS);
const perms = (...p: string[]) => new Set(p);

describe("listAudit", () => {
  it("mới nhất trước; phân trang", async () => {
    for (let i = 0; i < 25; i++) await log({ entityId: String(i), at: new Date(Date.UTC(2026, 8, 1, 0, i)) });
    const p1 = await listAudit(prisma, params(), new Date("2026-09-30T00:00:00Z"));
    expect(p1.total).toBe(25);
    expect(p1.rows).toHaveLength(20);
    expect(p1.rows[0]!.entityId).toBe("24");
    expect((await listAudit(prisma, params({ page: "2" }), new Date())).rows).toHaveLength(5);
  });

  it("cùng thời điểm: id lớn hơn trước (thứ tự ổn định giữa các trang)", async () => {
    const at = new Date("2026-09-01T00:00:00Z");
    for (let i = 0; i < 5; i++) await log({ entityId: String(i), at });
    const ids = (await listAudit(prisma, params({ pageSize: "10" }), new Date())).rows.map((r) => r.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });

  it("DTO danh sách KHÔNG mang beforeJson/afterJson/ip (không đọc JSON khi chỉ liệt kê)", async () => {
    await prisma.auditLog.create({ data: { action: "a", entity: "E", beforeJson: { unitCost: 1 }, afterJson: { unitCost: 2 }, ip: "1.2.3.4" } });
    const { rows } = await listAudit(prisma, params(), new Date());
    expect(Object.keys(rows[0]!).sort()).toEqual(["action", "at", "entity", "entityId", "id", "userId"]);
  });

  it("lọc theo người thao tác, đối tượng, từ khóa hành động", async () => {
    await log({ userId: 1, entity: "User", action: "user.lock" });
    await log({ userId: 2, entity: "User", action: "user.create" });
    await log({ userId: 2, entity: "Role", action: "role.create" });
    expect((await listAudit(prisma, params({ user: "2" }), new Date())).total).toBe(2);
    expect((await listAudit(prisma, params({ entity: "Role" }), new Date())).total).toBe(1);
    expect((await listAudit(prisma, params({ q: "create" }), new Date())).total).toBe(2);
    expect((await listAudit(prisma, params({ user: "2", entity: "User" }), new Date())).total).toBe(1);
    expect((await listAudit(prisma, params({ user: "1,2", entity: "User,Role" }), new Date())).total).toBe(3);
  });

  it("từ khóa: không phân biệt hoa/thường; khớp cả đối tượng và mã; ký tự % _ là chữ thường (không phải wildcard)", async () => {
    await log({ action: "order.update", entity: "SaleOrder", entityId: "SO-00123" });
    await log({ action: "user.lock", entity: "User", entityId: "7" });
    expect((await listAudit(prisma, params({ q: "SALEORDER" }), new Date())).total).toBe(1);
    expect((await listAudit(prisma, params({ q: "00123" }), new Date())).total).toBe(1);
    expect((await listAudit(prisma, params({ q: "%" }), new Date())).total).toBe(0);
    expect((await listAudit(prisma, params({ q: "o_der" }), new Date())).total).toBe(0);
  });

  it("filter người thao tác rác (chữ, số lẻ) bị bỏ qua chứ không làm lỗi truy vấn", async () => {
    await log();
    expect((await listAudit(prisma, params({ user: "abc,1.5" }), new Date())).total).toBe(1);
    expect((await listAudit(prisma, params({ user: "99999999999" }), new Date())).total).toBe(1); // ngoài Int32 → bỏ qua
  });

  it("sắp xếp chỉ theo cột cho phép (at/action/entity); cột lạ → mặc định thời gian giảm dần", async () => {
    await log({ action: "b.act", entityId: "1", at: new Date("2026-09-01T00:00:00Z") });
    await log({ action: "a.act", entityId: "2", at: new Date("2026-09-02T00:00:00Z") });
    const ids = async (sort?: string) =>
      (await listAudit(prisma, params(sort ? { sort } : {}), new Date())).rows.map((r) => r.entityId);
    expect(await ids()).toEqual(["2", "1"]);
    expect(await ids("at")).toEqual(["1", "2"]);
    expect(await ids("-at")).toEqual(["2", "1"]);
    expect(await ids("action")).toEqual(["2", "1"]); // a.act < b.act
    expect(await ids("-action")).toEqual(["1", "2"]);
    expect(await ids("beforeJson")).toEqual(["2", "1"]); // không cho sort theo cột JSON
    expect(await ids("ip")).toEqual(["2", "1"]);
  });

  it("lọc thời gian theo ICT: 23:50 ICT 30/09 thuộc 'Hôm nay' của 30/09 và 'Tháng này', KHÔNG thuộc 'Hôm nay' của 01/10", async () => {
    const at = new Date("2026-09-30T16:50:00Z"); // 23:50 ICT 30/09
    await log({ at });
    const sameDay = new Date("2026-09-30T16:55:00Z"); // 23:55 ICT 30/09
    const nextDay = new Date("2026-09-30T17:05:00Z"); // 00:05 ICT 01/10
    expect((await listAudit(prisma, params({ timePreset: "today" }), sameDay)).total).toBe(1);
    expect((await listAudit(prisma, params({ timePreset: "thisMonth" }), sameDay)).total).toBe(1);
    expect((await listAudit(prisma, params({ timePreset: "today" }), nextDay)).total).toBe(0);
    expect((await listAudit(prisma, params({ timePreset: "thisMonth" }), nextDay)).total).toBe(0);
    expect((await listAudit(prisma, params({ timePreset: "lastMonth" }), nextDay)).total).toBe(1);
  });

  it("biên nửa mở theo ICT: 00:00 ICT 01/10 (17:00Z 30/09) thuộc ngày/tháng 10, KHÔNG thuộc 30/09; 16:59:59.999Z thuộc 30/09", async () => {
    await log({ entityId: "last", at: new Date("2026-09-30T16:59:59.999Z") }); // 23:59:59.999 ICT 30/09
    await log({ entityId: "first", at: new Date("2026-09-30T17:00:00.000Z") }); // 00:00:00 ICT 01/10
    const on30 = new Date("2026-09-30T05:00:00Z");
    const on01 = new Date("2026-10-01T05:00:00Z"); // 12:00 ICT 01/10
    const ids = async (p: Record<string, string>, now: Date) => (await listAudit(prisma, params(p), now)).rows.map((r) => r.entityId);
    expect(await ids({ timePreset: "today" }, on30)).toEqual(["last"]);
    expect(await ids({ timePreset: "today" }, on01)).toEqual(["first"]);
    expect(await ids({ timePreset: "thisMonth" }, on30)).toEqual(["last"]);
    expect(await ids({ timePreset: "thisMonth" }, on01)).toEqual(["first"]);
    expect(await ids({ timePreset: "lastMonth" }, on01)).toEqual(["last"]);
  });

  it("khoảng tùy chọn gồm cả ngày kết thúc", async () => {
    await log({ at: new Date("2026-09-15T16:59:00Z") }); // 23:59 ICT 15/09
    const r = await listAudit(prisma, params({ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15" }), new Date());
    expect(r.total).toBe(1);
    await log({ at: new Date("2026-09-15T17:00:00Z") }); // 00:00 ICT 16/09 — ngoài
    expect((await listAudit(prisma, params({ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15" }), new Date())).total).toBe(1);
  });

  it("khoảng tùy chọn thiếu/đảo ngược → không lọc thời gian", async () => {
    await log();
    expect((await listAudit(prisma, params({ timePreset: "custom", timeStart: "2026-09-15" }), new Date())).total).toBe(1);
    expect((await listAudit(prisma, params({ timePreset: "custom", timeStart: "2026-09-15", timeEnd: "2026-09-01" }), new Date())).total).toBe(1);
  });

  it("50.000 dòng: trang đầu và trang xa đều ≤ 3 giây (hợp đồng hiệu năng)", async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO audit_log ("userId", action, entity, "entityId", "at")
      SELECT 1 + (g % 5), 'order.update', 'SaleOrder', g::text, now() - (g || ' seconds')::interval
      FROM generate_series(1, 50000) g`);
    for (const page of ["1", "2000"]) {
      const t = performance.now();
      const r = await listAudit(prisma, params({ page }), new Date());
      expect(r.total).toBe(50000);
      expect(performance.now() - t).toBeLessThan(3000);
    }
  }, 60_000);
});

describe("listAuditEntities", () => {
  it("danh sách đối tượng duy nhất, sắp theo tên", async () => {
    await log({ entity: "User" });
    await log({ entity: "Role" });
    await log({ entity: "User" });
    expect(await listAuditEntities(prisma)).toEqual(["Role", "User"]);
  });
});

describe("getAuditEntry", () => {
  it("trả bản ghi kèm before/after; không có → lỗi 404", async () => {
    const row = await prisma.auditLog.create({ data: { action: "a", entity: "E", beforeJson: { x: 1 }, afterJson: { x: 2 } } });
    expect((await getAuditEntry(prisma, row.id)).afterJson).toEqual({ x: 2 });
    await expect(getAuditEntry(prisma, 99999)).rejects.toMatchObject({ status: 404 });
  });
});

describe("toAuditDetail — đường ĐỌC audit áp redactDeep theo quyền người xem", () => {
  async function entry() {
    return prisma.auditLog.create({
      data: {
        userId: 1, action: "product.update", entity: "Product", entityId: "9", ip: "10.0.0.1",
        beforeJson: { name: "Tôn 0.45", qty: "10.5000", unitCost: "90000", nested: { salePrice: "120000", note: "a" } },
        afterJson: { name: "Tôn 0.45 mạ kẽm", qty: "12", unitCost: "95000", nested: { salePrice: "125000", note: "b" } },
      },
    });
  }
  const paths = (d: { changes: { path: string }[] }) => d.changes.map((c) => c.path);

  it("người xem THIẾU cost.view/sale_price.view: unitCost và salePrice biến mất khỏi số cũ/số mới", async () => {
    const d = toAuditDetail(await entry(), "Nam", perms("audit.view"));
    expect(paths(d)).toEqual(["name", "nested.note", "qty"]);
    expect(JSON.stringify(d)).not.toMatch(/unitCost|salePrice|90000|95000|120000|125000/);
    expect(d.hiddenByPermission).toBe(true);
  });

  it("người xem CÓ cost.view nhưng không sale_price.view: chỉ giá vốn hiện", async () => {
    const d = toAuditDetail(await entry(), "Nam", perms("audit.view", "cost.view"));
    expect(paths(d)).toEqual(["name", "nested.note", "qty", "unitCost"]);
    expect(d.changes.find((c) => c.path === "unitCost")).toEqual({ path: "unitCost", before: "90000", after: "95000" });
    expect(JSON.stringify(d)).not.toMatch(/salePrice/);
    expect(d.hiddenByPermission).toBe(true);
  });

  it("người xem có đủ quyền: thấy tất cả, không có cờ 'ẩn theo quyền'", async () => {
    const d = toAuditDetail(await entry(), "Nam", perms("audit.view", "cost.view", "sale_price.view"));
    expect(paths(d)).toEqual(["name", "nested.note", "nested.salePrice", "qty", "unitCost"]);
    expect(d.hiddenByPermission).toBe(false);
  });

  it("DTO chỉ gồm siêu dữ liệu + danh sách thay đổi đã định dạng; không có beforeJson/afterJson thô", async () => {
    const d = toAuditDetail(await entry(), "Nam", perms("audit.view"));
    expect(Object.keys(d).sort()).toEqual(["action", "at", "by", "changes", "entity", "entityId", "hiddenByPermission", "id", "ip", "truncated"]);
    expect(d.at).toBe((await prisma.auditLog.findFirstOrThrow()).at.toISOString());
    expect(d.by).toBe("Nam");
    expect(d.changes.find((c) => c.path === "qty")).toEqual({ path: "qty", before: "10,5", after: "12" });
  });

  it("thay đổi chỉ nằm ở field bị ẩn → danh sách rỗng NHƯNG có cờ 'ẩn theo quyền' (không bị hiểu nhầm là không có số liệu)", async () => {
    const row = await prisma.auditLog.create({ data: { action: "a", entity: "E", beforeJson: { unitCost: 1 }, afterJson: { unitCost: 2 } } });
    const d = toAuditDetail(row, "X", perms("audit.view"));
    expect(d.changes).toEqual([]);
    expect(d.hiddenByPermission).toBe(true);
  });

  it("không có before/after → không có thay đổi, không ẩn", async () => {
    const row = await prisma.auditLog.create({ data: { action: "user.login", entity: "User" } });
    expect(toAuditDetail(row, "X", perms("audit.view"))).toMatchObject({ changes: [], hiddenByPermission: false, truncated: false });
  });

  it("payload rất lớn: tối đa MAX_CHANGES dòng thay đổi, đánh dấu truncated; mỗi giá trị bị cắt", async () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < MAX_CHANGES + 50; i++) big[`k${String(i).padStart(4, "0")}`] = "y".repeat(5000);
    const row = await prisma.auditLog.create({ data: { action: "a", entity: "E", afterJson: big } });
    const d = toAuditDetail(row, "X", perms("audit.view"));
    expect(d.changes).toHaveLength(MAX_CHANGES);
    expect(d.truncated).toBe(true);
    expect(d.changes[0]!.after.length).toBeLessThanOrEqual(2001);
  });
});
