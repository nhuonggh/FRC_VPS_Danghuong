import { Prisma } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/permissions/catalog";
import type { Actor } from "@/lib/permissions/scope";
import { decideAdjustment, requestAdjustment } from "@/server/cash/adjust";
import { createExpense, editExpense, expenseSchema } from "@/server/cash/expenses";
import { voidCashClose } from "@/server/cash/close";
import { adjustmentRequestSchema, receiptSchema } from "@/server/cash/schemas";
import { cancelVoucher, createReceipt, editReceipt, returnVoucher, reviewVoucher } from "@/server/cash/vouchers";
import { cancelDebtAdjustment, cancelDebtTransfer, createDebtAdjustment, createDebtTransfer } from "@/server/debt/service";
import { debtAdjustmentSchema, debtTransferSchema } from "@/server/debt/schemas";
import { cancelDeliveryNote, createDeliveryNote } from "@/server/delivery/service";
import { deliveryNoteSchema } from "@/server/delivery/schemas";
import { cancelDeposit, createDeposit, releaseDeposit } from "@/server/deposits/service";
import { depositSchema } from "@/server/deposits/schemas";
import { cancelSettlement, reconcileSettlement } from "@/server/discount/settle";
import { cancelPurchaseTx } from "@/server/purchase/service";
import { cancelReturnTx } from "@/server/returns/service";
import { cancelSaleOrderTx, confirmDraftOrderTx } from "@/server/sales/lifecycle";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { convertQuote, createQuote, updateQuote } from "@/server/quotes/service";
import { quoteSchema } from "@/server/quotes/schemas";
import { cancelStocktake } from "@/server/stocktake/service";
import { cancelTrip, createTrip, departTrip } from "@/server/trips/service";
import { tripSchema } from "@/server/trips/schemas";
import { cancelProductionOrderTx } from "@/server/production/service";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makeUser } from "../helpers/factories";
import { buy, engine, newWorld, T, useNoopCostOwners, type World } from "../inventory/helpers";

/**
 * MA TRẬN XUYÊN KỲ (Plan 07 F0, spec 4.4). Mỗi dòng = một thao tác lên chứng từ SINH Ở KỲ A rồi kỳ A bị kết sổ (kỳ B mở).
 * Quy tắc: chứng từ kỳ đóng KHÔNG sửa/hủy/trả lại/duyệt điều chỉnh; hậu kiểm và chứng từ MỚI ở kỳ mở thì được.
 * Bảng "đã chốt" ở docs/superpowers/plans/2026-10-02-07-f0-cross-period-matrix.md — đổi hành vi nào phải sửa cả hai nơi.
 */
useNoopCostOwners();
const ALL = new Set(PERMISSIONS.map((p) => p.code));
const NOW = new Date("2026-09-15T03:00:00Z");
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
const err = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as { name?: string; status?: number; message: string });
/** "Bị chặn vì kỳ đã đóng": PeriodClosedError, hoặc DomainError 409 nhắc tới kỳ đã kết sổ/đã đóng. */
const closedErr = (e: Awaited<ReturnType<typeof err>>) => e !== null && (e.name === "PeriodClosedError" || (e.status === 409 && /kỳ đã (kết sổ|đóng)/i.test(e.message)));

let w: World; let actor: Actor; let customer: { id: number }; let other: { id: number }; let supplier: { id: number }; let cash: { id: number };
const ids: Record<string, number> = {};

beforeAll(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: ALL };
  customer = await makePartner({ isCustomer: true, allowCredit: true, debtLimit: 1_000_000_000 });
  other = await makePartner({ isCustomer: true });
  supplier = await makePartner({ isCustomer: false, isSupplier: true });
  cash = await makeCashAccount();
  const user = await makeUser();
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));

  const so = (qty: number) => saleOrderSchema.parse({ partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty, salePrice: 50_000, discountNow: 0, discountAccum: 0, processingTypeId: null, note: "" }] });
  ids.order = (await createSaleOrderIdempotent(prisma, actor, "m-o1", so(4), NOW)).id;
  ids.orderForTrip = (await createSaleOrderIdempotent(prisma, actor, "m-o2", so(2), NOW)).id;
  ids.orderForNote = (await createSaleOrderIdempotent(prisma, actor, "m-o3", so(3), NOW)).id;
  ids.orderUndelivered = (await createSaleOrderIdempotent(prisma, actor, "m-o4", so(1), NOW)).id;
  const qIn = quoteSchema.parse({ partnerId: customer.id, date: "2026-09-15", note: "", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 4, salePrice: 50_000, note: "" }] });
  ids.quote = (await tx((t) => createQuote(t, actor, qIn, NOW))).id;
  ids.quoteEdit = (await tx((t) => createQuote(t, actor, qIn, NOW))).id;
  const q2 = await tx((t) => createQuote(t, actor, qIn, NOW));
  ids.draft = (await tx((t) => convertQuote(t, actor, q2.id, NOW))).orderId;

  const noteLine = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: ids.orderForNote } });
  ids.lineUndelivered = (await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: ids.orderUndelivered } })).id;
  ids.note = (await tx((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId: ids.orderForNote, date: "2026-09-15", note: "", lines: [{ orderLineId: noteLine.id, qty: 1 }] }), NOW))).id;

  const rIn = (over: Record<string, unknown> = {}) => receiptSchema.parse({ type: "KHAC", partnerId: null, orderId: null, cashAccountId: cash.id, amount: 100_000, date: "2026-09-15", note: "", ...over });
  ids.receipt = (await tx((t) => createReceipt(t, actor, rIn(), NOW))).id;
  ids.receiptToReturn = (await tx((t) => createReceipt(t, actor, rIn(), NOW))).id;
  ids.receiptToReview = (await tx((t) => createReceipt(t, actor, rIn(), NOW))).id;
  ids.receiptReviewed = (await tx((t) => createReceipt(t, actor, rIn(), NOW))).id;
  await tx((t) => reviewVoucher(t, actor, "RECEIPT", ids.receiptReviewed!, NOW));
  ids.payment = await prisma.payment.create({ data: { periodId: w.periodId, code: "PC-M", kind: "KHAC", amount: 50_000, cashAccountId: cash.id, at: NOW, createdBy: user.id } }).then((p) => p.id);
  const dep = await tx((t) => createDeposit(t, actor, depositSchema.parse({ orderId: ids.orderUndelivered, amount: 10_000, cashAccountId: cash.id, date: "2026-09-15", note: "" }), NOW));
  ids.depositCancel = dep.id;
  ids.depositRelease = (await tx((t) => createDeposit(t, actor, depositSchema.parse({ orderId: ids.orderUndelivered, amount: 5_000, cashAccountId: cash.id, date: "2026-09-15", note: "" }), NOW))).id;
  const et = await prisma.expenseType.create({ data: { name: "Điện" } });
  const exInput = expenseSchema.parse({ expenseTypeId: et.id, cashAccountId: cash.id, amount: 800_000, date: "2026-09-15", note: "Điện" });
  ids.expense = (await tx((t) => createExpense(t, actor, exInput, NOW))).id;
  ids.adjustment = (await prisma.cashAdjustment.create({ data: { periodId: w.periodId, docType: "RECEIPT", docId: ids.receiptReviewed!, kind: "VOID", reason: "x", oldAmount: 100_000, oldCashAccountId: cash.id, requestedBy: user.id } })).id;

  ids.debtAdj = (await tx((t) => createDebtAdjustment(t, actor, debtAdjustmentSchema.parse({ partnerId: customer.id, reason: "KHAC", direction: "INCREASE", amount: 10_000, date: "2026-09-15", note: "n" }), NOW))).id;
  ids.debtTransfer = (await tx((t) => createDebtTransfer(t, actor, debtTransferSchema.parse({ kind: "TRANSFER", fromPartnerId: customer.id, toPartnerId: other.id, amount: 5_000, date: "2026-09-15", note: "" }), NOW))).id;
  const settlement = await prisma.discountSettlement.create({ data: { periodId: w.periodId, code: "CK-M", partnerId: customer.id, method: "OFFSET", amount: 1_000, at: NOW, createdBy: user.id } });
  await prisma.discountLedger.create({ data: { periodId: w.periodId, partnerId: customer.id, amountOut: 1_000, settleMethod: "OFFSET", docType: "DISCOUNT_SETTLE", docId: settlement.id, at: NOW, createdBy: user.id } });
  ids.settlement = settlement.id;
  ids.purchase = (await prisma.purchase.create({ data: { periodId: w.periodId, code: "PN-M", partnerId: supplier.id, at: NOW, createdBy: user.id } })).id;
  ids.stocktake = (await prisma.stocktake.create({ data: { periodId: w.periodId, code: "KK-M", at: NOW, createdBy: user.id } })).id;
  ids.production = (await prisma.productionOrder.create({ data: { periodId: w.periodId, code: "SX-M", productId: w.p.id, qty: 1, at: NOW, createdBy: user.id } })).id;
  ids.goodsReturn = (await prisma.goodsReturn.create({ data: { periodId: w.periodId, code: "TH-M", kind: "BY_PRODUCT", partnerId: customer.id, at: NOW, totalAmount: 0, createdBy: user.id } })).id;
  ids.cashClose = (await prisma.cashClose.create({ data: { periodId: w.periodId, cashAccountId: cash.id, closeAt: NOW, expected: 0, actual: 0, diff: 0, createdBy: user.id } })).id;
  const vehicle = await prisma.vehicle.create({ data: { plate: "51C-1" } });
  const driver = await prisma.driver.create({ data: { name: "Lái" } });
  const tripIn = (orderIds: number[]) => tripSchema.parse({ date: "2026-09-16", routeId: null, vehicleId: vehicle.id, driverId: driver.id, assistantId: null, note: "", orderIds });
  ids.trip = (await tx((t) => createTrip(t, actor, tripIn([ids.orderForTrip!]), NOW))).id;

  // ── KẾT SỔ kỳ A (giả lập đúng trạng thái sau engine kết sổ F1b): A CLOSED, B OPEN
  await prisma.period.update({ where: { id: w.periodId }, data: { status: "CLOSED", isOpen: null, closedAt: new Date("2026-09-30T17:00:00Z") } });
  await prisma.period.create({ data: { name: "Kỳ B", status: "OPEN", isOpen: true, openedAt: new Date("2026-09-30T17:00:00Z") } });
});

type Case = { label: string; run: () => Promise<unknown> };
const blocked: Case[] = [
  { label: "Phiếu thu: sửa", run: () => tx((t) => editReceipt(t, actor, ids.receipt!, receiptSchema.parse({ type: "KHAC", partnerId: null, orderId: null, cashAccountId: cash.id, amount: 1, date: "2026-10-01", note: "" }), NOW)) },
  { label: "Phiếu thu: hủy", run: () => tx((t) => cancelVoucher(t, actor, "RECEIPT", ids.receipt!, "x", NOW)) },
  { label: "Phiếu thu: TRẢ LẠI (lỗ hổng F0 đã vá)", run: () => tx((t) => returnVoucher(t, actor, "RECEIPT", ids.receiptToReturn!, "sai")) },
  { label: "Phiếu chi: hủy", run: () => tx((t) => cancelVoucher(t, actor, "PAYMENT", ids.payment!, "x", NOW)) },
  { label: "Phiếu thu đã kiểm: yêu cầu điều chỉnh", run: () => tx((t) => requestAdjustment(t, actor, "RECEIPT", ids.receiptReviewed!, adjustmentRequestSchema.parse({ kind: "VOID", reason: "x" }))) },
  { label: "Yêu cầu điều chỉnh đang chờ: duyệt", run: () => tx((t) => decideAdjustment(t, actor, ids.adjustment!, { approve: true, note: "" }, NOW)) },
  { label: "Chi phí: sửa", run: () => tx((t) => editExpense(t, actor, ids.expense!, expenseSchema.parse({ expenseTypeId: 1, cashAccountId: cash.id, amount: 1, date: "2026-10-01", note: "x" }), NOW)) },
  { label: "Cọc: hủy", run: () => tx((t) => cancelDeposit(t, actor, ids.depositCancel!, NOW)) },
  { label: "Cọc: nhả khỏi đơn", run: () => tx((t) => releaseDeposit(t, actor, ids.depositRelease!)) },
  { label: "Phiếu giao: hủy", run: () => tx((t) => cancelDeliveryNote(t, actor, ids.note!)) },
  { label: "Điều chỉnh công nợ: hủy", run: () => tx((t) => cancelDebtAdjustment(t, actor, ids.debtAdj!, "x", NOW)) },
  { label: "Chuyển/gộp công nợ: hủy", run: () => tx((t) => cancelDebtTransfer(t, actor, ids.debtTransfer!, "x", NOW)) },
  { label: "Tất toán chiết khấu: hủy", run: () => tx((t) => cancelSettlement(t, actor, ids.settlement!, "x", NOW)) },
  { label: "Phiếu nhập: hủy", run: () => cancelPurchaseTx(prisma, actor, ids.purchase!, "x") },
  { label: "Đơn bán: hủy", run: () => cancelSaleOrderTx(prisma, actor, ids.order!, "x") },
  { label: "Phiếu trả hàng: hủy", run: () => cancelReturnTx(prisma, actor, ids.goodsReturn!, "x") },
  { label: "Lệnh sản xuất: hủy", run: () => cancelProductionOrderTx(prisma, actor, ids.production!, "x") },
  { label: "Chuyến giao: xuất phát", run: () => tx((t) => departTrip(t, actor, ids.trip!, NOW)) },
  { label: "Chuyến giao: hủy", run: () => tx((t) => cancelTrip(t, actor, ids.trip!, "x", NOW)) },
  { label: "Lần chốt quỹ: hủy chốt (lỗ hổng F0 đã vá)", run: () => tx((t) => voidCashClose(t, actor, ids.cashClose!, "x", NOW)) },
  { label: "Đơn bán kỳ cũ: tạo phiếu giao MỚI (hiện chặn — F1d quyết định có mở không)", run: () => tx((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId: ids.orderUndelivered, date: "2026-10-01", note: "", lines: [{ orderLineId: ids.lineUndelivered!, qty: 1 }] }), NOW)) },
  { label: "Đơn bán kỳ cũ: xếp lên chuyến MỚI (hiện chặn — F1d)", run: () => tx((t) => createTrip(t, actor, tripSchema.parse({ date: "2026-10-02", routeId: null, vehicleId: 1, driverId: 1, assistantId: null, note: "", orderIds: [ids.orderUndelivered!] }), NOW)) },
];

describe("ma trận xuyên kỳ — chứng từ kỳ đã kết sổ KHÔNG sửa/hủy được", () => {
  it.each(blocked.map((c) => [c.label, c] as const))("%s → bị chặn vì kỳ đã đóng", async (_label, c) => {
    const e = await err(c.run());
    expect(closedErr(e), `lỗi nhận được: ${e?.name} ${e?.status} ${e?.message}`).toBe(true);
  });

  it("sau cả bảng thao tác bị chặn: không chứng từ nào đổi trạng thái (không hủy, không ghi sổ thêm)", async () => {
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: ids.receipt! } })).isCancelled).toBe(false);
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: ids.receiptToReturn! } })).reviewStatus).toBe("PENDING_REVIEW");
    expect((await prisma.saleOrder.findUniqueOrThrow({ where: { id: ids.order! } })).isCancelled).toBe(false);
    expect((await prisma.cashClose.findUniqueOrThrow({ where: { id: ids.cashClose! } })).voidedAt).toBeNull();
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: ids.trip! } })).status).toBe("PLANNED");
    expect((await prisma.cashAdjustment.findUniqueOrThrow({ where: { id: ids.adjustment! } })).status).toBe("REQUESTED");
  });
});

describe("ma trận xuyên kỳ — được phép (có chủ đích)", () => {
  it("hậu kiểm phiếu thu kỳ cũ vẫn làm được (không đổi số liệu)", async () => {
    await tx((t) => reviewVoucher(t, actor, "RECEIPT", ids.receiptToReview!, NOW));
    expect((await prisma.receipt.findUniqueOrThrow({ where: { id: ids.receiptToReview! } })).reviewStatus).toBe("REVIEWED");
  });

  it("hậu kiểm tất toán chiết khấu kỳ cũ vẫn làm được", async () => {
    await tx((t) => reconcileSettlement(t, actor, ids.settlement!, NOW));
    const row = await prisma.discountLedger.findFirstOrThrow({ where: { docType: "DISCOUNT_SETTLE", docId: ids.settlement! } });
    expect(row.isReconciled).toBe(true);
  });

  it("thu nợ đơn kỳ cũ: phiếu thu MỚI mang kỳ mới, đơn vẫn thuộc kỳ cũ", async () => {
    const period = await prisma.period.findFirstOrThrow({ where: { isOpen: true } });
    const r = await tx((t) => createReceipt(t, actor, receiptSchema.parse({ type: "THU_NO", partnerId: customer.id, orderId: ids.order!, cashAccountId: cash.id, amount: 20_000, date: "2026-10-01", note: "" }), new Date("2026-10-01T03:00:00Z")));
    const row = await prisma.receipt.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.periodId).toBe(period.id);
    expect((await prisma.saleOrder.findUniqueOrThrow({ where: { id: ids.order! } })).periodId).toBe(w.periodId);
  });

  it("chứng từ mới ở kỳ mở: báo giá kỳ cũ chuyển thành đơn nháp MỚI thuộc kỳ mở", async () => {
    const period = await prisma.period.findFirstOrThrow({ where: { isOpen: true } });
    const out = await tx((t) => convertQuote(t, actor, ids.quote!, new Date("2026-10-01T03:00:00Z")));
    expect((await prisma.saleOrder.findUniqueOrThrow({ where: { id: out.orderId } })).periodId).toBe(period.id);
  });

  it("GHI NHẬN lệch quy tắc, quyết định ở F1b (mang sang kỳ mới khi kết sổ): sửa báo giá/đơn nháp của kỳ cũ hiện KHÔNG bị chặn bởi kỳ", async () => {
    // Báo giá chưa chốt không giữ kho/tiền → F1b chuyển sang kỳ mới (checklist cảnh báo 'open-quotes'); đơn nháp thì lockOrderForDelivery đã chặn.
    const input = quoteSchema.parse({ partnerId: customer.id, date: "2026-09-15", note: "sửa sau kết sổ", lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 1, salePrice: 1, note: "" }] });
    await expect(tx((t) => updateQuote(t, actor, ids.quoteEdit!, input, NOW))).resolves.toBeDefined();
    expect(closedErr(await err(confirmDraftOrderTx(prisma, actor, ids.draft!)))).toBe(true);
  });
});
