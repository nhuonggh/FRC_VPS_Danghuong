import type { Prisma, PrismaClient } from "@prisma/client";
import { formatCurrency, formatDate } from "@/lib/format";
import { getOpenPeriod } from "./guard";

type Db = PrismaClient | Prisma.TransactionClient;


export type CloseSeverity = "BLOCK" | "WARN";

export interface CloseFinding {
  key: string;
  severity: CloseSeverity;
  title: string;
  /** Vì sao mục này chặn/cảnh báo và cách xử lý — hiển thị dưới tiêu đề. */
  hint: string;
  count: number;
  items: { id: number; code: string; description: string; href: string }[];
}

/** Số dòng tối đa mỗi mục hiển thị; `count` luôn là tổng thật. */
export const CLOSE_ITEM_LIMIT = 20;

const TRIP_STATUS: Record<string, string> = {
  PLANNED: "Chưa xuất phát", ON_ROAD: "Đang giao", RETURNED: "Đã về, chưa đối soát", SETTLED: "Đã đối soát, chờ thủ quỹ xác nhận",
};
const RECOMPUTE_STATUS: Record<string, string> = { PENDING: "đang chờ tính lại", RUNNING: "đang tính lại", FAILED: "tính lại bị lỗi" };
const UNDELIVERED = ["NEW", "WAITING_STOCK", "READY", "LOADED", "DELIVERING", "PARTIAL"] as const;

const finding = (f: Omit<CloseFinding, "items"> & { items: CloseFinding["items"] }): CloseFinding => f;

/**
 * Điều kiện kết sổ của KỲ ĐANG MỞ (spec 4.2). BLOCK = chặn cứng (engine kết sổ F1b không chạy khi còn mục nào);
 * WARN = cho kết nhưng người kết phải biết. Mọi mục chỉ nhìn chứng từ của kỳ mở và có link tới từng chứng từ vướng.
 * Thêm điều kiện mới (vd gia công thuê E3): thêm một `finding` vào `blockers`/`warnings` — UI và bộ đếm tự theo.
 */
export async function getCloseChecklist(db: Db) {
  const period = await getOpenPeriod(db);
  const periodId = period.id;
  const take = CLOSE_ITEM_LIMIT;
  const asc = { orderBy: [{ id: "asc" as const }], take };

  const provisionalWhere: Prisma.SaleOrderLineWhereInput = { isProvisional: true, order: { periodId, isCancelled: false, isDraft: false } };
  const tripWhere: Prisma.TripWhereInput = { periodId, status: { notIn: ["CONFIRMED", "CANCELLED"] } };
  const stocktakeWhere: Prisma.StocktakeWhereInput = { periodId, status: "DRAFT" };
  const draftWhere: Prisma.SaleOrderWhereInput = { periodId, isDraft: true, isCancelled: false };
  const quoteWhere: Prisma.QuoteWhereInput = { periodId, status: { in: ["DRAFT", "SENT"] } };
  const depositWhere: Prisma.ReceiptWhereInput = { periodId, type: "COC", isCancelled: false, order: { isCancelled: false, deliveryStatus: { not: "DELIVERED" } } };
  const undeliveredWhere: Prisma.SaleOrderWhereInput = { periodId, isDraft: false, isCancelled: false, deliveryStatus: { in: [...UNDELIVERED] } };
  const returnedReceiptWhere: Prisma.ReceiptWhereInput = { periodId, isCancelled: false, reviewStatus: "RETURNED" };
  const returnedPaymentWhere: Prisma.PaymentWhereInput = { periodId, isCancelled: false, reviewStatus: "RETURNED" };
  const pendingReceiptWhere: Prisma.ReceiptWhereInput = { periodId, isCancelled: false, reviewStatus: "PENDING_REVIEW" };
  const pendingPaymentWhere: Prisma.PaymentWhereInput = { periodId, isCancelled: false, reviewStatus: "PENDING_REVIEW" };
  const adjustmentWhere: Prisma.CashAdjustmentWhereInput = { periodId, status: "REQUESTED" };

  const [
    periodRow, provisionalCount, provisionalLines, tripCount, trips, stocktakeCount, stocktakes, recomputeJobs, recomputingProducts,
    returnedReceiptCount, returnedReceipts, returnedPaymentCount, returnedPayments, adjustmentCount, adjustments,
    draftCount, drafts, quoteCount, quotes, depositCount, deposits, undeliveredCount, undelivered,
    pendingReceiptCount, pendingPaymentCount,
  ] = await Promise.all([
    db.period.findUniqueOrThrow({ where: { id: periodId }, select: { name: true } }),
    db.saleOrderLine.count({ where: provisionalWhere }),
    db.saleOrderLine.findMany({
      where: provisionalWhere, orderBy: [{ order: { orderDate: "asc" } }, { id: "asc" }], take,
      select: { id: true, qty: true, unit: true, product: { select: { code: true, name: true } }, order: { select: { id: true, code: true } } },
    }),
    db.trip.count({ where: tripWhere }),
    db.trip.findMany({ where: tripWhere, orderBy: [{ tripDate: "asc" }, { id: "asc" }], take, select: { id: true, code: true, status: true, tripDate: true } }),
    db.stocktake.count({ where: stocktakeWhere }),
    db.stocktake.findMany({ where: stocktakeWhere, orderBy: [{ at: "asc" }, { id: "asc" }], take, select: { id: true, code: true, at: true } }),
    // Hàng đợi tính lại giá vốn chưa xong: kết sổ lúc này sẽ chốt giá vốn sai (spec 3.5).
    db.recomputeJob.findMany({ where: { periodId }, orderBy: { id: "asc" }, select: { id: true, productId: true, status: true } }),
    db.product.findMany({ where: { recomputing: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    db.receipt.count({ where: returnedReceiptWhere }),
    db.receipt.findMany({ where: returnedReceiptWhere, ...asc, select: { id: true, code: true, amount: true } }),
    db.payment.count({ where: returnedPaymentWhere }),
    db.payment.findMany({ where: returnedPaymentWhere, ...asc, select: { id: true, code: true, amount: true } }),
    db.cashAdjustment.count({ where: adjustmentWhere }),
    db.cashAdjustment.findMany({ where: adjustmentWhere, ...asc, select: { id: true, docType: true, docId: true, kind: true } }),
    db.saleOrder.count({ where: draftWhere }),
    db.saleOrder.findMany({ where: draftWhere, orderBy: [{ orderDate: "asc" }, { id: "asc" }], take, select: { id: true, code: true, partner: { select: { name: true } } } }),
    db.quote.count({ where: quoteWhere }),
    db.quote.findMany({ where: quoteWhere, orderBy: [{ at: "asc" }, { id: "asc" }], take, select: { id: true, code: true, partner: { select: { name: true } } } }),
    db.receipt.count({ where: depositWhere }),
    db.receipt.findMany({ where: depositWhere, orderBy: [{ at: "asc" }, { id: "asc" }], take, select: { id: true, code: true, amount: true, order: { select: { code: true } } } }),
    db.saleOrder.count({ where: undeliveredWhere }),
    db.saleOrder.findMany({ where: undeliveredWhere, orderBy: [{ expectedDeliveryDate: "asc" }, { id: "asc" }], take, select: { id: true, code: true, expectedDeliveryDate: true, partner: { select: { name: true } } } }),
    db.receipt.count({ where: pendingReceiptWhere }),
    db.payment.count({ where: pendingPaymentWhere }),
  ]);

  const settlements = await db.discountSettlement.findMany({
    where: { periodId, isCancelled: false }, orderBy: [{ at: "asc" }, { id: "asc" }],
    select: { id: true, code: true, partnerId: true, partner: { select: { name: true } } },
  });
  const settlementIds = settlements.map((row) => row.id);
  const unreviewed = settlementIds.length
    ? await db.discountLedger.findMany({ where: { periodId, docType: "DISCOUNT_SETTLE", docId: { in: settlementIds }, isReconciled: false }, select: { docId: true } })
    : [];
  const unreviewedIds = new Set(unreviewed.map((row) => row.docId));
  const unsettled = settlements.filter((row) => unreviewedIds.has(row.id));

  const productCodes = new Map((await db.product.findMany({ where: { id: { in: recomputeJobs.map((j) => j.productId) } }, select: { id: true, code: true, name: true } })).map((p) => [p.id, p]));
  // Một mã vừa có job vừa có cờ chỉ tính một lần (đếm theo mã hàng).
  const recomputeItems = new Map<number, { id: number; code: string; description: string; href: string }>();
  for (const j of recomputeJobs) {
    const p = productCodes.get(j.productId);
    recomputeItems.set(j.productId, { id: j.productId, code: p?.code ?? `#${j.productId}`, description: `${p?.name ?? "Mã hàng"} · ${RECOMPUTE_STATUS[j.status] ?? j.status}`, href: `/inventory/products/${j.productId}` });
  }
  for (const p of recomputingProducts) if (!recomputeItems.has(p.id)) recomputeItems.set(p.id, { id: p.id, code: p.code, description: `${p.name} · đang tính lại giá vốn`, href: `/inventory/products/${p.id}` });

  const returnedCount = returnedReceiptCount + returnedPaymentCount;
  const returnedItems = [
    ...returnedReceipts.map((r) => ({ id: r.id, code: r.code, description: `Phiếu thu · ${formatCurrency(r.amount)} · bị thủ quỹ trả lại`, href: `/accounting/receipts/${r.id}` })),
    ...returnedPayments.map((p) => ({ id: p.id, code: p.code, description: `Phiếu chi · ${formatCurrency(p.amount)} · bị thủ quỹ trả lại`, href: `/accounting/payments/${p.id}` })),
  ].slice(0, take);

  const blockers: CloseFinding[] = [
    finding({
      key: "provisional-sales", severity: "BLOCK", title: "Đơn bán còn thiếu tồn", count: provisionalCount,
      hint: "Dòng bán âm kho chưa có giá vốn. Nhập bù hàng (nhập mua/kiểm kho) để hệ thống tính giá vốn trước khi kết sổ.",
      items: provisionalLines.map((line) => ({ id: line.order.id, code: line.order.code, description: `${line.product.code} · ${line.product.name} · thiếu giá vốn cho ${line.qty.toString()} ${line.unit}`, href: `/sales/orders/${line.order.id}` })),
    }),
    finding({
      key: "open-trips", severity: "BLOCK", title: "Chuyến giao chưa xác nhận hoàn tất", count: tripCount,
      hint: "Chuyến phải đi hết, đối soát lái xe và thủ quỹ xác nhận tiền (hoặc hủy chuyến) trước khi kết sổ.",
      items: trips.map((trip) => ({ id: trip.id, code: trip.code, description: `${TRIP_STATUS[trip.status] ?? trip.status} · ${formatDate(trip.tripDate)}`, href: `/delivery/trips/${trip.id}` })),
    }),
    finding({
      key: "draft-stocktakes", severity: "BLOCK", title: "Phiếu kiểm kho còn nháp", count: stocktakeCount,
      hint: "Chốt hoặc hủy phiếu kiểm kho; phiếu nháp chưa ghi chênh lệch vào sổ kho.",
      items: stocktakes.map((stocktake) => ({ id: stocktake.id, code: stocktake.code, description: `Ngày ${formatDate(stocktake.at)}`, href: `/inventory/stocktakes/${stocktake.id}` })),
    }),
    finding({
      key: "recompute", severity: "BLOCK", title: "Giá vốn đang tính lại", count: recomputeItems.size,
      hint: "Hệ thống đang tính lại giá vốn chạy nền cho các mã này. Chờ xong (hoặc xử lý job lỗi) rồi kết sổ.",
      items: [...recomputeItems.values()].slice(0, take),
    }),
    finding({
      key: "returned-vouchers", severity: "BLOCK", title: "Phiếu thu/chi bị thủ quỹ trả lại", count: returnedCount,
      hint: "Sau khi kết sổ không sửa được phiếu của kỳ cũ. Kế toán sửa và gửi lại (hoặc hủy phiếu) ngay bây giờ.",
      items: returnedItems,
    }),
    finding({
      key: "pending-adjustments", severity: "BLOCK", title: "Yêu cầu điều chỉnh phiếu đang chờ duyệt", count: adjustmentCount,
      hint: "Thủ quỹ duyệt hoặc từ chối trước khi kết sổ; kỳ cũ không duyệt được nữa.",
      items: adjustments.map((a) => ({ id: a.id, code: `ĐC-${a.id}`, description: `${a.docType === "RECEIPT" ? "Phiếu thu" : "Phiếu chi"} #${a.docId} · ${a.kind === "VOID" ? "xin hủy" : "xin đổi số tiền"}`, href: "/accounting/cash-review" })),
    }),
  ];
  const warnings: CloseFinding[] = [
    finding({
      key: "draft-orders", severity: "WARN", title: "Đơn nháp sẽ được mang sang kỳ mới", count: draftCount,
      hint: "Đơn nháp chưa xuất kho/ghi sổ nên được chuyển sang kỳ mới. Kiểm tra xem còn cần giữ không.",
      items: drafts.map((order) => ({ id: order.id, code: order.code, description: order.partner.name, href: `/sales/orders/${order.id}` })),
    }),
    finding({
      key: "open-quotes", severity: "WARN", title: "Báo giá chưa chốt sẽ được mang sang kỳ mới", count: quoteCount,
      hint: "Báo giá nháp/đã gửi chưa chuyển thành đơn. Hủy những báo giá không còn dùng.",
      items: quotes.map((q) => ({ id: q.id, code: q.code, description: q.partner.name, href: `/sales/quotes/${q.id}` })),
    }),
    finding({
      key: "undelivered-orders", severity: "WARN", title: "Đơn còn hàng chưa giao đủ", count: undeliveredCount,
      hint: "Đơn vẫn thuộc kỳ cũ sau khi kết sổ. Giao nốt đơn kỳ cũ cần cơ chế xuyên kỳ (F1d) — nên giao xong trước khi kết sổ.",
      items: undelivered.map((o) => ({ id: o.id, code: o.code, description: `${o.partner.name} · hẹn ${formatDate(o.expectedDeliveryDate)}`, href: `/sales/orders/${o.id}` })),
    }),
    finding({
      key: "unused-deposits", severity: "WARN", title: "Tiền cọc còn gắn đơn chưa giao đủ", count: depositCount,
      hint: "Cọc đã ghi nhận ở kỳ này; đơn chưa giao xong nên cọc chưa được trừ hết.",
      items: deposits.map((receipt) => ({ id: receipt.id, code: receipt.code, description: `${receipt.order!.code} · ${formatCurrency(receipt.amount)}`, href: `/accounting/receipts/${receipt.id}` })),
    }),
    finding({
      key: "unreconciled-discounts", severity: "WARN", title: "Tất toán chiết khấu chưa hậu kiểm", count: unsettled.length,
      hint: "Hậu kiểm vẫn làm được sau khi kết sổ, nhưng nên xong trước để số chiết khấu mang sang đã được xác nhận.",
      items: unsettled.slice(0, take).map((row) => ({ id: row.id, code: row.code, description: row.partner.name, href: `/accounting/discounts/${row.partnerId}` })),
    }),
    finding({
      key: "pending-review", severity: "WARN", title: "Phiếu thu/chi chưa hậu kiểm", count: pendingReceiptCount + pendingPaymentCount,
      hint: "Thủ quỹ hậu kiểm tại màn Hậu kiểm quỹ. Phiếu của kỳ cũ vẫn hậu kiểm được, nhưng không còn trả lại để sửa được.",
      items: pendingReceiptCount + pendingPaymentCount > 0 ? [{ id: 0, code: "Hậu kiểm quỹ", description: `${pendingReceiptCount} phiếu thu · ${pendingPaymentCount} phiếu chi chờ kiểm`, href: "/accounting/cash-review" }] : [],
    }),
  ];

  return {
    period: { ...period, name: periodRow.name },
    blockers,
    warnings,
    blockerCount: blockers.reduce((total, item) => total + item.count, 0),
    warningCount: warnings.reduce((total, item) => total + item.count, 0),
  };
}
