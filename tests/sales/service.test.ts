import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { prisma, resetDb } from "../helpers/db";
import { makeBomVersion, makePartner, makeProcessingType, makeProduct } from "../helpers/factories";
import { assertLedgerBalanced, buy, engine, newWorld, T, type World } from "../inventory/helpers";

// Không dùng useNoopCostOwners: test dùng chủ dòng THẬT của SALE (đăng ký ở owners-register.ts).
const NOW = new Date("2026-09-15T03:00:00Z"); // 10:00 ICT 15/09
const FULL = ["order.create", "sale_price.view", "order.edit_price", "partner.view_all"];
let w: World; let actor: Actor; let customer: { id: number };
let n = 0;

const line = (productId: number, qty: number, salePrice: number, over: Record<string, unknown> = {}) =>
  ({ productId, unit: "", qty, salePrice, discountNow: 0, discountAccum: 0, processingTypeId: null, ...over });
const order = async (lines: ReturnType<typeof line>[], over: Record<string, unknown> = {}, who: Actor = actor) => {
  const withUnits = await Promise.all(lines.map(async (l) => ({ ...l, unit: l.unit || (await prisma.product.findUniqueOrThrow({ where: { id: l.productId } })).baseUnit })));
  const input = saleOrderSchema.parse({ partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: withUnits, ...over });
  return createSaleOrderIdempotent(prisma, who, `key-${++n}`, input, NOW);
};
const linesOf = (orderId: number) => prisma.saleOrderLine.findMany({ where: { orderId }, orderBy: { id: "asc" } });

beforeEach(async () => {
  await resetDb();
  w = await newWorld(3);
  actor = { userId: w.userId, perms: new Set(FULL) };
  customer = await makePartner({ isCustomer: true });
});

describe("createSaleOrder — giá vốn FIFO qua chủ dòng SALE (spec 3.2)", () => {
  it("case của khách: nhập 100@20.000 → bán 30 → nhập 100@22.000 → bán 90 = 70@20.000 + 20@22.000", async () => {
    const p = w.p.id;
    const run = engine(w);
    await run([p], (ctx) => buy(ctx, p, 100, 20_000, T(0), 1));
    const o1 = await order([line(p, 30, 30_000)], { date: "2026-09-03", expectedDeliveryDate: "2026-09-03" });
    await run([p], (ctx) => buy(ctx, p, 100, 22_000, new Date("2026-09-05T03:00:00Z"), 2));
    const o2 = await order([line(p, 90, 31_000)], { date: "2026-09-10", expectedDeliveryDate: "2026-09-10" });

    const [l1] = await linesOf(o1.id); const [l2] = await linesOf(o2.id);
    expect(l1).toMatchObject({ isProvisional: false });
    expect(l1!.unitCostFifo.toString()).toBe("20000");
    expect(l2!.unitCostFifo.toString()).toBe("20444.4444");
    expect(o1.code).toMatch(/^DH\d{6}$/);
    await assertLedgerBalanced(p, w.periodId);
  });

  it("bán âm kho → dòng treo; nhập bù → engine tính lại và gỡ cờ treo qua chủ dòng", async () => {
    const p = w.p.id; const run = engine(w);
    await run([p], (ctx) => buy(ctx, p, 20, 10_000, T(0), 1));
    const o = await order([line(p, 50, 15_000)], { date: "2026-09-10", expectedDeliveryDate: "2026-09-10" });
    expect((await linesOf(o.id))[0]!.isProvisional).toBe(true);

    await run([p], (ctx) => buy(ctx, p, 100, 12_000, new Date("2026-09-12T03:00:00Z"), 2));
    const after = (await linesOf(o.id))[0]!;
    expect(after.isProvisional).toBe(false);
    // 20@10.000 + 30@12.000 = 560.000 / 50
    expect(after.unitCostFifo.toString()).toBe("11200");
    await assertLedgerBalanced(p, w.periodId);
  });

  it("hai người bán cùng mã đồng thời (60 + 60, tồn 100): tổng đúng, một đơn treo 20, sổ cân", async () => {
    const p = w.p.id;
    await engine(w)([p], (ctx) => buy(ctx, p, 100, 10_000, T(0), 1));
    const res = await Promise.all([order([line(p, 60, 20_000)]), order([line(p, 60, 20_000)])]);
    const all = (await Promise.all(res.map((r) => linesOf(r.id)))).flat();
    expect(all.filter((l) => l.isProvisional)).toHaveLength(1);
    await assertLedgerBalanced(p, w.periodId);
  });

  it("bấm hai lần (cùng Idempotency-Key) chỉ tạo MỘT đơn và MỘT lần xuất kho", async () => {
    const p = w.p.id;
    await engine(w)([p], (ctx) => buy(ctx, p, 100, 10_000, T(0), 1));
    const input = saleOrderSchema.parse({ partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: [line(p, 10, 20_000, { unit: w.p.baseUnit })] });
    const [a, b] = await Promise.all([1, 2].map(() => createSaleOrderIdempotent(prisma, actor, "same-key", input, NOW)));
    expect(b).toEqual(a);
    expect(await prisma.saleOrder.count()).toBe(1);
    expect(await prisma.stockLedger.count({ where: { docType: "SALE" } })).toBe(1);
  });
});

describe("bán hàng gia công (tôn xốp) — xuất NVL theo BOM (D-20)", () => {
  it("giá vốn dòng = tổng vốn NVL / SL, lưu bomVersionId, KHÔNG xuất chính thành phẩm", async () => {
    const fg = await makeProduct({ kind: "THANH_PHAM" }); const m1 = await makeProduct({ kind: "NVL" }); const m2 = await makeProduct({ kind: "NVL" });
    const pt = await makeProcessingType();
    const v = await makeBomVersion({ productId: fg.id, processingTypeId: pt.id, createdBy: w.userId, validFrom: "2026-09-01", lines: [{ materialProductId: m1.id, qtyPerUnit: "1.2" }, { materialProductId: m2.id, qtyPerUnit: "0.5" }] });
    const run = engine(w);
    await run([m1.id], (ctx) => buy(ctx, m1.id, 100, 10_000, T(0), 1));
    await run([m2.id], (ctx) => buy(ctx, m2.id, 100, 2_000, T(1), 2));

    const o = await order([line(fg.id, 10, 50_000, { processingTypeId: pt.id })]);
    const [l] = await linesOf(o.id);
    expect(l!.bomVersionId).toBe(v.id);
    expect(l!.unitCostFifo.toString()).toBe("13000"); // (12×10.000 + 5×2.000) / 10
    expect(l!.isProvisional).toBe(false);
    expect(await prisma.stockLedger.count({ where: { docType: "SALE", productId: fg.id } })).toBe(0);
    const issues = await prisma.saleLineIssue.findMany({ where: { orderLineId: l!.id }, orderBy: { productId: "asc" } });
    expect(issues.map((i) => [i.productId, i.qtyBase.toString()])).toEqual([[m1.id, "12"], [m2.id, "5"]]);
    expect(issues.every((i) => i.seq !== null)).toBe(true);
  });

  it("thiếu một NVL → đơn treo; chưa có định mức hiệu lực → lỗi rõ ràng, không ghi gì", async () => {
    const fg = await makeProduct({ kind: "THANH_PHAM" }); const m1 = await makeProduct({ kind: "NVL" });
    const pt = await makeProcessingType();
    await expect(order([line(fg.id, 1, 1, { processingTypeId: pt.id })])).rejects.toThrow(/chưa có định mức hiệu lực/);
    expect(await prisma.saleOrder.count()).toBe(0);
    await makeBomVersion({ productId: fg.id, processingTypeId: pt.id, createdBy: w.userId, validFrom: "2026-09-01", lines: [{ materialProductId: m1.id, qtyPerUnit: 1 }] });
    const o = await order([line(fg.id, 5, 1_000, { processingTypeId: pt.id })]);
    expect((await linesOf(o.id))[0]!.isProvisional).toBe(true);
  });
});

describe("quyền và phạm vi", () => {
  it("thiếu order.create hoặc sale_price.view → 403, không ghi gì", async () => {
    const p = w.p.id;
    await expect(order([line(p, 1, 1)], {}, { userId: w.userId, perms: new Set(["sale_price.view"]) })).rejects.toThrow();
    await expect(order([line(p, 1, 1)], {}, { userId: w.userId, perms: new Set(["order.create"]) })).rejects.toThrow();
    expect(await prisma.saleOrder.count()).toBe(0);
  });

  it("thiếu order.edit_price: giá phải bằng giá gần nhất (theo đơn vị), lần đầu chưa có giá tham chiếu → chặn", async () => {
    const p = w.p.id;
    await engine(w)([p], (ctx) => buy(ctx, p, 1000, 1_000, T(0), 1));
    const seller: Actor = { userId: w.userId, perms: new Set(["order.create", "sale_price.view", "partner.view_all"]) };
    await expect(order([line(p, 1, 20_000)], {}, seller)).rejects.toMatchObject({ status: 403 }); // chưa có giá tham chiếu
    await order([line(p, 1, 20_000)]); // người có quyền sửa giá đặt giá đầu tiên
    await expect(order([line(p, 1, 19_000)], {}, seller)).rejects.toThrow(/không có quyền sửa giá bán/);
    await expect(order([line(p, 2, 20_000)], {}, seller)).resolves.toMatchObject({ id: expect.any(Number) });
  });

  it("khách ngoài phạm vi 'khách của mình' → 404 (không lộ tồn tại); không phải khách hàng → 400", async () => {
    const p = w.p.id;
    const narrow: Actor = { userId: w.userId, perms: new Set(["order.create", "sale_price.view", "order.edit_price"]) }; // không partner.view_all
    await expect(order([line(p, 1, 1)], {}, narrow)).rejects.toMatchObject({ status: 404 });
    const supplierOnly = await makePartner({ isCustomer: false, isSupplier: true });
    await expect(order([line(p, 1, 1)], { partnerId: supplierOnly.id })).rejects.toMatchObject({ status: 400 });
  });
});

describe("chiết khấu, kiểm dữ liệu, audit", () => {
  it("chiết khấu tích lũy ghi discount_ledger theo dòng; trừ ngay không ghi sổ chiết khấu", async () => {
    const p = w.p.id;
    await engine(w)([p], (ctx) => buy(ctx, p, 100, 10_000, T(0), 1));
    const o = await order([line(p, 10, 20_000, { discountNow: 5_000, discountAccum: 10_000 })]);
    const [l] = await linesOf(o.id);
    const rows = await prisma.discountLedger.findMany({ where: { docType: "SALE", docId: o.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orderLineId: l!.id, partnerId: customer.id });
    expect(rows[0]!.amountIn.toString()).toBe("10000");
    expect(l!.discountNow.toString()).toBe("5000");
  });

  it("schema chặn: SL ≤ 0, quá 3 số lẻ, tổng chiết khấu vượt giá trị dòng, ngày giao trước ngày đơn, 0 dòng", () => {
    const base = { partnerId: 1, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "" };
    const ok = line(1, 1, 100, { unit: "md" });
    expect(saleOrderSchema.safeParse({ ...base, lines: [ok] }).success).toBe(true);
    expect(saleOrderSchema.safeParse({ ...base, lines: [{ ...ok, qty: 0 }] }).success).toBe(false);
    expect(saleOrderSchema.safeParse({ ...base, lines: [{ ...ok, qty: 1.2345 }] }).success).toBe(false);
    expect(saleOrderSchema.safeParse({ ...base, lines: [{ ...ok, discountNow: 60, discountAccum: 50 }] }).success).toBe(false);
    expect(saleOrderSchema.safeParse({ ...base, expectedDeliveryDate: "2026-09-14", lines: [ok] }).success).toBe(false);
    expect(saleOrderSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
  });

  it("ngày tương lai, mã ngừng bán, đơn vị chưa khai báo → lỗi tiếng Việt; audit không chứa giá", async () => {
    const p = w.p.id;
    await engine(w)([p], (ctx) => buy(ctx, p, 100, 10_000, T(0), 1));
    await expect(order([line(p, 1, 1)], { date: "2026-09-16", expectedDeliveryDate: "2026-09-16" })).rejects.toThrow(/tương lai/);
    await expect(order([line(p, 1, 1, { unit: "thùng" })])).rejects.toThrow(/chưa khai báo đơn vị/);
    const off = await makeProduct({ isActive: false });
    await expect(order([line(off.id, 1, 1)])).rejects.toThrow(/ngừng bán/);

    const o = await order([line(p, 3, 77_777, { discountNow: 1_234 })]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "sale.create", entityId: String(o.id) } });
    const dump = JSON.stringify(audit.afterJson);
    expect(dump).toContain("lineCount");
    expect(dump).not.toMatch(/77777|1234|salePrice|unitCost/);
  });
});
