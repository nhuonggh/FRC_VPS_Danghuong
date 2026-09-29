import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { advanceExpectedDeliveryDates, getOrder, listOrders, listPendingLines, ORDER_FILTER_KEYS, resetAdvanceMemo } from "@/server/sales/queries";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { delayDays, effectiveDeliveryStatus } from "@/server/sales/status";
import { prisma, resetDb } from "../helpers/db";
import { makePartner } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

const NOW = new Date("2026-09-15T03:00:00Z"); // 10:00 ICT 15/09
const WRITER = ["order.create", "sale_price.view", "order.edit_price", "partner.view_all"];
const params = (sp: Record<string, string> = {}) => parseListParams(sp, ORDER_FILTER_KEYS);
let w: World; let writer: Actor; let customer: { id: number }; let n = 0;

const make = async (qty: number, over: Record<string, unknown> = {}, partnerId = customer.id) => {
  const input = saleOrderSchema.parse({
    partnerId, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "",
    lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty, salePrice: 30_000, discountNow: 1_000, discountAccum: 2_000, processingTypeId: null }], ...over,
  });
  return createSaleOrderIdempotent(prisma, writer, `k-${++n}`, input, NOW);
};

beforeEach(async () => {
  await resetDb(); resetAdvanceMemo();
  w = await newWorld(1);
  writer = { userId: w.userId, perms: new Set(WRITER) };
  customer = await makePartner({ isCustomer: true, name: "Nguyễn Văn Đạt", searchText: "nguyen van dat" });
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 10_000, T(0), 1));
});

describe("status", () => {
  it("trạng thái giao suy ra từ cờ treo; số ngày trễ theo ICT, đơn xong/hủy không trễ", () => {
    expect(effectiveDeliveryStatus("NEW", true)).toBe("WAITING_STOCK");
    expect(effectiveDeliveryStatus("NEW", false)).toBe("READY");
    expect(effectiveDeliveryStatus("PARTIAL", true)).toBe("PARTIAL");
    const o = { originalDeliveryDate: new Date("2026-09-12T00:00:00Z"), deliveryStatus: "NEW" as const, isCancelled: false };
    expect(delayDays(o, new Date("2026-09-15T16:59:59Z"))).toBe(3); // 23:59:59 ICT 15/09
    expect(delayDays(o, new Date("2026-09-15T17:00:00Z"))).toBe(4); // 00:00 ICT 16/09
    expect(delayDays(o, new Date("2026-09-12T10:00:00Z"))).toBe(0);
    expect(delayDays({ ...o, deliveryStatus: "DELIVERED" }, NOW)).toBe(0);
    expect(delayDays({ ...o, isCancelled: true }, NOW)).toBe(0);
  });
});

describe("listOrders", () => {
  it("lọc theo trạng thái HIỂN THỊ: đơn đủ tồn = Sẵn hàng, đơn treo = Chờ hàng; stats đếm đúng", async () => {
    const ok = await make(5); const pending = await make(20); // tồn 10 → đơn 2 thiếu
    const all = await listOrders(prisma, writer, params(), NOW);
    expect(all.rows.map((r) => r.code).sort()).toEqual([ok.code, pending.code].sort());
    const byCode = new Map(all.rows.map((r) => [r.code, r]));
    expect(byCode.get(ok.code)).toMatchObject({ deliveryStatus: "READY", hasProvisional: false });
    expect(byCode.get(pending.code)).toMatchObject({ deliveryStatus: "WAITING_STOCK", hasProvisional: true });
    expect((await listOrders(prisma, writer, params({ delivery: "WAITING_STOCK" }), NOW)).rows.map((r) => r.code)).toEqual([pending.code]);
    expect((await listOrders(prisma, writer, params({ delivery: "READY" }), NOW)).rows.map((r) => r.code)).toEqual([ok.code]);
    expect((await listOrders(prisma, writer, params({ pending: "1" }), NOW)).total).toBe(1);
    expect(all.stats).toEqual({ all: 2, pending: 1, late: 0 });
  });

  it("tìm không dấu theo tên khách và theo mã đơn; tổng tiền = SL×giá − CK trừ ngay (CK tích lũy không trừ)", async () => {
    const o = await make(2);
    const rows = (q: string) => listOrders(prisma, writer, params({ q }), NOW).then((r) => r.rows);
    expect((await rows("nguyen van dat"))).toHaveLength(1);
    expect((await rows(o.code.toLowerCase()))).toHaveLength(1);
    expect((await rows("khong ton tai"))).toHaveLength(0);
    expect((await rows("nguyen"))[0]!.orderTotal).toBe("59000"); // 2×30.000 − 1.000
  });

  it("phạm vi: thiếu partner.view_all chỉ thấy đơn của khách mình phụ trách", async () => {
    const mine = await makePartner({ isCustomer: true, ownerUserId: w.userId });
    await make(1); await make(1, {}, mine.id);
    const seller: Actor = { userId: w.userId, perms: new Set(["order.view"]) };
    const res = await listOrders(prisma, seller, params(), NOW);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]!.partnerId).toBe(mine.id);
    expect(res.stats.all).toBe(1);
  });

  it("thiếu sale_price.view: DTO danh sách KHÔNG có orderTotal", async () => {
    await make(1);
    const kho: Actor = { userId: w.userId, perms: new Set(["order.view", "partner.view_all"]) };
    const row = (await listOrders(prisma, kho, params(), NOW)).rows[0]!;
    expect("orderTotal" in row).toBe(false);
    expect(JSON.stringify(row)).not.toMatch(/30000|59000/);
  });
});

describe("getOrder", () => {
  it("chi tiết: lãi dòng = thành tiền − CK tích lũy − vốn; dòng treo không có lãi; lịch sử từ audit", async () => {
    const o = await make(4); // 4×30.000 − 1.000 = 119.000; − CK tích lũy 2.000; vốn 4×10.000
    const d = await getOrder(prisma, writer, o.id, NOW);
    expect(d.lines[0]).toMatchObject({ isProvisional: false, lineAmount: "119000" });
    expect("unitCostFifo" in d.lines[0]!).toBe(false); // writer không có cost.view → bị lược
    expect("lineProfit" in d.lines[0]!).toBe(false); // và không có profit.view
    const boss: Actor = { userId: w.userId, perms: new Set([...WRITER, "cost.view", "profit.view"]) };
    const full = await getOrder(prisma, boss, o.id, NOW);
    expect(full.lines[0]!.unitCostFifo).toBe("10000");
    expect(full.lines[0]!.lineProfit).toBe("77000"); // 119.000 − 2.000 − 40.000
    expect(full.history.map((h) => h.action)).toEqual(["sale.create"]);
    expect(full.deliveryStatus).toBe("READY");

    const pending = await make(30);
    expect((await getOrder(prisma, boss, pending.id, NOW)).lines[0]!.lineProfit).toBeNull();
  });

  it("redaction theo quyền: thủ kho không thấy giá, CK, vốn, lãi; người bán không thấy vốn/lãi", async () => {
    const o = await make(4);
    const kho: Actor = { userId: w.userId, perms: new Set(["order.view", "partner.view_all"]) };
    const dumpKho = JSON.stringify(await getOrder(prisma, kho, o.id, NOW));
    expect(dumpKho).not.toMatch(/salePrice|discountNow|discountAccum|lineAmount|unitCostFifo|lineProfit|orderTotal/);
    const seller = JSON.stringify(await getOrder(prisma, writer, o.id, NOW));
    expect(seller).toMatch(/salePrice/);
    expect(seller).not.toMatch(/unitCostFifo|lineProfit/);
  });

  it("đơn không tồn tại / ngoài phạm vi khách → 404", async () => {
    const o = await make(1);
    await expect(getOrder(prisma, writer, 999_999, NOW)).rejects.toMatchObject({ status: 404 });
    const narrow: Actor = { userId: w.userId, perms: new Set(["order.view"]) };
    await expect(getOrder(prisma, narrow, o.id, NOW)).rejects.toMatchObject({ status: 404 });
  });
});

describe("đơn chưa đủ tồn & dời ngày giao", () => {
  it("listPendingLines: chỉ dòng treo, không có giá", async () => {
    await make(5); const p = await make(20);
    const res = await listPendingLines(prisma, writer, params());
    expect(res.total).toBe(1);
    expect(res.rows[0]).toMatchObject({ orderCode: p.code, productCode: expect.any(String) });
    expect(JSON.stringify(res.rows)).not.toMatch(/salePrice|30000/);
  });

  it("advanceExpectedDeliveryDates: dời đơn trễ về hôm nay, giữ ngày gốc, idempotent, bỏ qua đơn đã giao/hủy", async () => {
    const late = await make(1, { date: "2026-09-10", expectedDeliveryDate: "2026-09-11" });
    const done = await make(1, { date: "2026-09-10", expectedDeliveryDate: "2026-09-11" });
    await prisma.saleOrder.update({ where: { id: done.id }, data: { deliveryStatus: "DELIVERED" } });
    const future = await make(1, { expectedDeliveryDate: "2026-09-20" });

    expect(await advanceExpectedDeliveryDates(prisma, NOW)).toBe(1);
    expect(await advanceExpectedDeliveryDates(prisma, NOW)).toBe(0); // cùng ngày: không làm lại
    resetAdvanceMemo();
    expect(await advanceExpectedDeliveryDates(prisma, NOW)).toBe(0); // không còn đơn quá hạn: idempotent ở DB

    const row = (id: number) => prisma.saleOrder.findUniqueOrThrow({ where: { id } });
    expect((await row(late.id)).expectedDeliveryDate.toISOString().slice(0, 10)).toBe("2026-09-15");
    expect((await row(late.id)).originalDeliveryDate.toISOString().slice(0, 10)).toBe("2026-09-11");
    expect((await row(done.id)).expectedDeliveryDate.toISOString().slice(0, 10)).toBe("2026-09-11");
    expect((await row(future.id)).expectedDeliveryDate.toISOString().slice(0, 10)).toBe("2026-09-20");
    const l = await listOrders(prisma, writer, params({ late: "1" }), NOW);
    expect(l.rows.map((r) => r.id)).toContain(late.id); // ngày gốc 11/09 < hôm nay → trễ 4 ngày
    expect(l.rows.find((r) => r.id === late.id)!.delayDays).toBe(4);
  });
});
