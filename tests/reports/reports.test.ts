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
const ALL = ["order.analysis.view", "profit.view", "report.view", "cost.view", "order.create", "order.edit", "order.cancel", "sale_price.view", "order.edit_price", "return.manage", "partner.view_all", "expense.manage", "receipt.manage", "payment.manage", "cash.transaction.create", "purchase_price.view"];
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World; let actor: Actor; let a: { id: number }; let b: { id: number }; let cash: { id: number };
let n = 0;
const P = (sp: Record<string, string> = {}) => parseListParams({ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-30", ...sp }, REPORT_FILTER_KEYS);
const run = (key: string, sp: Record<string, string> = {}, who = actor) => runReport(prisma, who, key, P(sp), NOW);
const order = (partnerId: number, over: { qty?: number; price?: number; dn?: number; da?: number; date?: string } = {}) => createSaleOrderIdempotent(prisma, actor, `r-${++n}`, saleOrderSchema.parse({ partnerId, date: over.date ?? "2026-09-15", expectedDeliveryDate: over.date ?? "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: over.qty ?? 4, salePrice: over.price ?? 50_000, discountNow: over.dn ?? 10_000, discountAccum: over.da ?? 20_000, processingTypeId: null, note: "" }] }), NOW);
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
    const filtered = await run("order-profit", { customer: String(a.id), order: String(good.id) });
    expect(filtered.rows.map((x) => x.code)).toEqual([good.code]);
    expect(filtered.totals).toMatchObject({ revenue: "190000", profit: "130000" });
    expect(filtered.orderDetail).toMatchObject({ id: good.id, figures: { revenue: "190000", accum: "20000", cost: "40000", profit: "130000" } });
    expect(filtered.orderDetail?.lines).toHaveLength(1);
    expect(filtered.orderDetail?.lines[0]).toMatchObject({ qty: "4", price: "50000", discountNow: "10000", profit: "130000" });
    expect((await run("order-profit", { customer: "invalid" })).rows).toHaveLength(0);
    const scoped = await run("order-profit", { order: String(good.id) }, { userId: -1, perms: new Set(ALL.filter((p) => p !== "partner.view_all")) });
    expect(scoped.orderDetail).toBeNull();
    expect(scoped.customers).toHaveLength(0);
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
    expect(r.summary).toContainEqual({ label: "Lãi ròng", value: "60000", money: true, tone: "success" });
    // 200.000 − 50.000 = 150.000 thuần; vốn 40.000 − 10.000 = 30.000; CK 40.000 − 10.000 = 30.000 ⇒ lãi gộp 90.000; − chi phí 30.000 = 60.000
  });
  it("CK chuyển vào lãi cộng vào lãi gộp đúng tháng của phiếu; phiếu hủy và loại CASH không tính", async () => {
    const period = await prisma.period.findFirstOrThrow();
    const mk = (code: string, method: "FORFEIT" | "OFFSET", amount: number, over: { isCancelled?: boolean; at?: string } = {}) =>
      prisma.discountSettlement.create({ data: { periodId: period.id, code, partnerId: a.id, method, amount, at: new Date(over.at ?? "2026-09-16T03:00:00Z"), createdBy: w.userId, ...(over.isCancelled ? { isCancelled: true, cancelledAt: NOW, cancelledBy: w.userId, cancelReason: "nhầm" } : {}) } });
    await mk("CK-T1", "FORFEIT", 10_000);
    await mk("CK-T2", "FORFEIT", 99_000, { isCancelled: true });
    await mk("CK-T3", "OFFSET", 77_000);
    await mk("CK-T4", "FORFEIT", 5_000, { at: "2026-08-20T03:00:00Z" });
    const r = await run("period-pnl");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ month: "09/2026", forfeit: "10000", gross: "10000", profit: "10000" });
    expect(r.totals).toMatchObject({ forfeit: "10000", profit: "10000" });
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
    const filtered = await run("by-customer", { customer: String(b.id) });
    expect(filtered.rows.map((x) => x.code)).toEqual(["KHB"]);
    expect(filtered.summary).toContainEqual({ label: "Doanh thu", value: "40000", money: true });
    expect(filtered.customers).toContainEqual({ value: String(b.id), label: "KHB — Khách B" });
    expect((await run("by-customer", { customer: "invalid" })).rows).toHaveLength(0);
    const byG = await run("by-group");
    expect(byG.rows.map((x) => [x.name, x.orders, x.net])).toEqual([["Đại lý", 2, "380000"], ["Khách lẻ", 1, "40000"]]);
    expect(byG.summary).toContainEqual({ label: "Nhóm khách hàng", value: 2 });
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
    expect(full.summary).toContainEqual({ label: "Giá vốn đã ghi nhận", value: "40000", money: true });
    expect(noCost.summary?.some((s) => s.money)).toBe(false);
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
    expect(r.summary).toContainEqual({ label: "Khoản mục lệch", value: 1, tone: "danger" });
    expect(r.summary).toContainEqual({ label: "Tổng lệch tuyệt đối", value: "5000", money: true, tone: "danger" });
    expect(r.notes!.join(" ")).toContain("mồ côi (chứng từ đã hủy/không còn): 1");
  });
});

describe("xuất Excel", () => {
  it("mọi báo cáo xuất được (kể cả dòng tổng)", async () => {
    await order(a.id);
    for (const k of ["order-profit", "period-pnl", "by-customer", "by-group", "issue-by-order", "debt-reconciliation"]) expect((await exportReportXlsx(prisma, actor, k, P())).byteLength, k).toBeGreaterThan(1000);
  });
});

describe("52/53 — tiêu hao thực tế và đối chiếu định mức", () => {
  const BOM = ["bom.manage", "report.view", "stocktake.manage", "order.create", "sale_price.view", "partner.view_all", "cost.view", "order.edit_price"];
  it("thực tế = định mức (xuất bán) + thiếu khi kiểm; đối chiếu gộp theo NVL, âm = vượt định mức; lọc + quyền", async () => {
    const { createStocktake, confirmStocktakeIdempotent } = await import("@/server/stocktake/service");
    const { stocktakeSchema } = await import("@/server/stocktake/schemas");
    await prisma.product.update({ where: { id: w.p.id }, data: { kind: "HANG", canUseAsMaterial: true } }); // báo cáo theo cờ "dùng làm nguyên liệu", không bắt đúng loại NVL
    const actor2: Actor = { userId: w.userId, perms: new Set([...ALL, ...BOM]) };
    await order(a.id, { qty: 4, date: "2026-09-10" }); // xuất 4 theo sổ sách; tồn còn 96
    const day = new Date("2026-09-12T03:00:00Z");
    const st = await createStocktake(prisma, actor2, stocktakeSchema.parse({ date: "2026-09-12", note: "", lines: [{ productId: w.p.id, actualQty: 93 }] }), day); // thiếu 3
    await confirmStocktakeIdempotent(prisma, actor2, "st1", st.id);
    const r = await runReport(prisma, actor2, "actual-consumption", P(), NOW);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ stocktake: st.code, code: w.p.code, norm: "4", shortage: "3", actual: "7" });
    expect(r.summary).toContainEqual({ label: "Dòng thiếu khi kiểm", value: 1, tone: "warning" });
    const c = await runReport(prisma, actor2, "consumption-compare", P(), NOW);
    expect(c.rows[0]).toMatchObject({ norm: "4", actual: "7", diff: "-3", count: 1 }); expect(c.rows[0]!.pct).toBe(-75); expect(c.negativeKey).toBe("diff");
    expect(c.summary).toContainEqual({ label: "Mã vượt định mức", value: 1, tone: "danger" });
    expect((await runReport(prisma, actor2, "consumption-compare", P({ neg: "1" }), NOW)).rows).toHaveLength(1);
    // lần kiểm sau: mốc trước là lần kiểm này ⇒ chỉ tính xuất sau đó
    await order(a.id, { qty: 2, date: "2026-09-14" });
    const st2 = await createStocktake(prisma, actor2, stocktakeSchema.parse({ date: "2026-09-15", note: "", lines: [{ productId: w.p.id, actualQty: 91 }] }), NOW);
    await confirmStocktakeIdempotent(prisma, actor2, "st2", st2.id);
    const r2 = await runReport(prisma, actor2, "actual-consumption", P(), NOW);
    expect(r2.rows.map((x) => [x.norm, x.shortage, x.actual])).toEqual([["4", "3", "7"], ["2", "0", "2"]]);
    await expect(runReport(prisma, { userId: 1, perms: new Set(["report.view"]) }, "actual-consumption", P(), NOW)).rejects.toMatchObject({ status: 403 });
    expect((await exportReportXlsx(prisma, actor2, "consumption-compare", P())).byteLength).toBeGreaterThan(1000);
  });
});

describe("72 — báo cáo sản xuất", () => {
  it("liệt kê lệnh còn hiệu lực trong kỳ; giá thành chỉ với cost.view; lệnh hủy không tính", async () => {
    const { createProductionOrderIdempotent, cancelProductionOrderTx } = await import("@/server/production/service");
    const pk = await prisma.product.create({ data: { code: "PK-R", name: "Nóc R", kind: "PHU_KIEN", canProduce: true, baseUnit: "cái" } });
    const a2: Actor = { userId: w.userId, perms: new Set([...ALL, "production.manage"]) };
    const mk = (qty: number, k: string) => createProductionOrderIdempotent(prisma, a2, k, { date: "2026-09-15", productId: pk.id, qty, note: "", materials: [{ productId: w.p.id, qty: 10 }] });
    const o1 = await mk(5, "p1"), o2 = await mk(2, "p2");
    await cancelProductionOrderTx(prisma, a2, o2.id, "nhầm");
    const r = await runReport(prisma, a2, "production", P(), NOW);
    expect(r.rows).toHaveLength(1); expect(r.rows[0]).toMatchObject({ code: o1.code, qty: "5", unitCost: "20000", totalCost: "100000" }); expect(r.totals).toMatchObject({ totalCost: "100000" });
    const nc = await runReport(prisma, { userId: w.userId, perms: new Set(["report.view"]) }, "production", P(), NOW);
    expect(nc.columns.some((c) => c.key === "unitCost")).toBe(false); expect(nc.rows[0]).not.toHaveProperty("unitCost");
    expect(r.summary).toContainEqual({ label: "Tổng giá thành đã ghi nhận", value: "100000", money: true });
    expect(nc.summary?.some((s) => s.money)).toBe(false);
  });
});
