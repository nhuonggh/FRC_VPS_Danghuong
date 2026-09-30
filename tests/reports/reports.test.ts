import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { createExpense } from "@/server/cash/expenses";
import { createPayment, createReceipt } from "@/server/cash/vouchers";
import { paymentSchema, receiptSchema } from "@/server/cash/schemas";
import { deliveryNoteSchema } from "@/server/delivery/schemas";
import { createDeliveryNote } from "@/server/delivery/service";
import { returnByOrderSchema } from "@/server/returns/schemas";
import { createReturnByOrderIdempotent } from "@/server/returns/service";
import { cancelSaleOrderTx } from "@/server/sales/lifecycle";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { exportReportXlsx } from "@/server/reports/export";
import { runReport } from "@/server/reports/queries";
import { REPORT_FILTER_KEYS } from "@/server/reports/types";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makePartnerGroup } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

const NOW = new Date("2026-09-15T03:00:00Z");
const ALL = ["profit.view", "report.view", "cost.view", "order.create", "order.edit", "order.cancel", "sale_price.view", "order.edit_price", "return.manage", "partner.view_all", "expense.manage", "receipt.manage", "payment.manage", "cash.transaction.create", "purchase_price.view"];
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World; let actor: Actor; let a: { id: number }; let b: { id: number }; let cash: { id: number };
let n = 0;
const P = (sp: Record<string, string> = {}) => parseListParams({ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-30", ...sp }, REPORT_FILTER_KEYS);
const run = (key: string, sp: Record<string, string> = {}, who = actor) => runReport(prisma, who, key, P(sp), NOW);
const order = (partnerId: number, over: { qty?: number; price?: number; dn?: number; da?: number } = {}) => createSaleOrderIdempotent(prisma, actor, `r-${++n}`, saleOrderSchema.parse({ partnerId, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: over.qty ?? 4, salePrice: over.price ?? 50_000, discountNow: over.dn ?? 10_000, discountAccum: over.da ?? 20_000, processingTypeId: null, note: "" }] }), NOW);
const row = (r: { rows: Record<string, unknown>[] }, key: string, val: unknown) => r.rows.find((x) => x[key] === val)!;

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(ALL) };
  const g1 = await makePartnerGroup("Đại lý"), g2 = await makePartnerGroup("Khách lẻ");
  a = await makePartner({ isCustomer: true, name: "Khách A", code: "KHA", groupId: g1.id }); b = await makePartner({ isCustomer: true, name: "Khách B", code: "KHB", groupId: g2.id });
  cash = await makeCashAccount();
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
});

describe("67 — lãi từng đơn", () => {
  it("lãi = thành tiền − CK tích lũy − giá vốn FIFO; đơn lỗ bôi đỏ và lọc được; đơn hủy/nháp không tính", async () => {
    const good = await order(a.id); // DT 190.000 − CK 20.000 − vốn 40.000 = 130.000
    const loss = await order(b.id, { price: 5_000, dn: 0, da: 0 }); // DT 20.000 − vốn 40.000 = −20.000
    const gone = await order(a.id); await cancelSaleOrderTx(prisma, actor, gone.id, "x");
    const r = await run("order-profit");
    expect(r.rows).toHaveLength(2);
    expect(row(r, "code", good.code)).toMatchObject({ revenue: "190000", accum: "20000", cost: "40000", profit: "130000", margin: 68.4 });
    expect(row(r, "code", loss.code)).toMatchObject({ profit: "-20000" });
    expect(r.totals).toMatchObject({ revenue: "210000", profit: "110000" }); expect(r.negativeKey).toBe("profit");
    expect((await run("order-profit", { neg: "1" })).rows.map((x) => x.code)).toEqual([loss.code]);
    expect((await run("order-profit", { q: "khách a" })).rows.map((x) => x.code)).toEqual([good.code]);
    expect((await run("order-profit", { timeStart: "2026-08-01", timeEnd: "2026-08-31" })).rows).toHaveLength(0);
  });
  it("thiếu quyền profit.view bị chặn; report.view không đủ", async () => {
    await expect(run("order-profit", {}, { userId: 1, perms: new Set(["report.view"]) })).rejects.toMatchObject({ status: 403 });
    await expect(run("period-pnl", {}, { userId: 1, perms: new Set(["report.view"]) })).rejects.toMatchObject({ status: 403 });
    await expect(run("nope")).rejects.toMatchObject({ status: 404 });
  });
});

describe("68 — lãi lỗ toàn xưởng", () => {
  it("DT − hàng trả + vốn hàng trả − giá vốn − CK tích lũy − chi phí, theo tháng", async () => {
    const o = await order(a.id, { qty: 4, dn: 0, da: 40_000 }); // DT 200.000, CK 40.000, vốn 40.000
    const line = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: o.id } });
    await tx((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId: o.id, date: "2026-09-15", note: "", lines: [{ orderLineId: line.id, qty: 4 }] }), NOW));
    await createReturnByOrderIdempotent(prisma, actor, "ret1", returnByOrderSchema.parse({ orderId: o.id, date: "2026-09-15", note: "", lines: [{ orderLineId: line.id, qty: 1 }] }), NOW); // trả 1/4: tiền 50.000, vốn 10.000, CK 10.000
    const et = await prisma.expenseType.create({ data: { name: "Điện" } });
    await tx((t) => createExpense(t, actor, { expenseTypeId: et.id, cashAccountId: cash.id, amount: 30_000, date: "2026-09-15", note: "" }, NOW));
    const r = await run("period-pnl");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ month: "09/2026", revenue: "200000", returns: "50000", cost: "30000", accum: "30000", gross: "90000", expense: "30000", profit: "60000" });
    // 200.000 − 50.000 = 150.000 thuần; vốn 40.000 − 10.000 = 30.000; CK 40.000 − 10.000 = 30.000 ⇒ lãi gộp 90.000; − chi phí 30.000 = 60.000
  });
  it("chi phí đã hủy không tính; tháng khác tách dòng", async () => {
    const et = await prisma.expenseType.create({ data: { name: "Điện" } });
    await tx((t) => createExpense(t, actor, { expenseTypeId: et.id, cashAccountId: cash.id, amount: 10_000, date: "2026-09-15", note: "" }, NOW));
    const cancelled = await tx((t) => createExpense(t, actor, { expenseTypeId: et.id, cashAccountId: cash.id, amount: 99_000, date: "2026-09-15", note: "" }, NOW));
    await prisma.payment.update({ where: { id: cancelled.paymentId }, data: { isCancelled: true, cancelledAt: NOW } });
    const r = await run("period-pnl");
    expect(r.totals).toMatchObject({ expense: "10000", profit: "-10000" });
  });
});

describe("69/70 — bán hàng theo khách và nhóm", () => {
  it("xếp theo doanh thu thuần, trừ hàng trả, gộp theo nhóm khách", async () => {
    await order(a.id); await order(a.id); await order(b.id, { qty: 1 });
    const byC = await run("by-customer");
    expect(byC.rows.map((x) => [x.code, x.orders, x.revenue])).toEqual([["KHA", 2, "380000"], ["KHB", 1, "40000"]]);
    expect(byC.totals).toMatchObject({ orders: 3, revenue: "420000" });
    const byG = await run("by-group");
    expect(byG.rows.map((x) => [x.name, x.orders, x.net])).toEqual([["Đại lý", 2, "380000"], ["Khách lẻ", 1, "40000"]]);
    expect((await run("by-customer", { q: "khb" })).rows).toHaveLength(1);
    await expect(run("by-customer", {}, { userId: 1, perms: new Set() })).rejects.toMatchObject({ status: 403 });
  });
});

describe("71 — xuất kho theo đơn", () => {
  it("mỗi dòng hàng một dòng; giá vốn chỉ hiện với cost.view", async () => {
    const o = await order(a.id);
    const full = await run("issue-by-order");
    expect(full.rows).toEqual([expect.objectContaining({ order: o.code, qty: "4", cost: "40000", customer: "Khách A" })]);
    const noCost = await run("issue-by-order", {}, { userId: actor.userId, perms: new Set(["report.view", "partner.view_all"]) });
    expect(noCost.columns.some((c) => c.key === "cost")).toBe(false); expect(noCost.rows[0]!.cost).toBeNull();
  });
});

describe("73 — đối chiếu công nợ", () => {
  it("sổ công nợ khớp chứng từ nguồn; phát hiện dòng sổ mồ côi", async () => {
    await tx((t) => createReceipt(t, actor, receiptSchema.parse({ type: "THU_NO", partnerId: a.id, orderId: null, cashAccountId: cash.id, amount: 70_000, date: "2026-09-15", note: "" }), NOW));
    const s = await makePartner({ isCustomer: false, isSupplier: true });
    await tx((t) => createPayment(t, actor, paymentSchema.parse({ kind: "TRA_NCC", partnerId: s.id, cashAccountId: cash.id, amount: 30_000, date: "2026-09-15", note: "" }), NOW));
    let r = await run("debt-reconciliation");
    expect(row(r, "item", "Phiếu thu (ghi có, không tính tiền lái xe/chuyến)")).toMatchObject({ ledger: "70000", source: "70000", diff: "0" });
    expect(row(r, "item", "Phiếu chi trả NCC / hoàn khách (ghi nợ)")).toMatchObject({ ledger: "30000", diff: "0" });
    expect(r.notes!.join(" ")).toContain("mồ côi (chứng từ đã hủy/không còn): 0"); expect(r.notes!.join(" ")).toContain("đều khớp");
    await prisma.partnerLedger.create({ data: { periodId: w.periodId, partnerId: a.id, credit: 5_000, docType: "RECEIPT", docId: 987654, at: NOW, createdBy: w.userId } });
    r = await run("debt-reconciliation");
    expect(row(r, "item", "Phiếu thu (ghi có, không tính tiền lái xe/chuyến)")).toMatchObject({ diff: "5000" });
    expect(r.notes!.join(" ")).toContain("mồ côi (chứng từ đã hủy/không còn): 1");
  });
});

describe("xuất Excel", () => {
  it("mọi báo cáo xuất được (kể cả dòng tổng)", async () => {
    await order(a.id);
    for (const k of ["order-profit", "period-pnl", "by-customer", "by-group", "issue-by-order", "debt-reconciliation"]) expect((await exportReportXlsx(prisma, actor, k, P())).byteLength, k).toBeGreaterThan(1000);
  });
});
