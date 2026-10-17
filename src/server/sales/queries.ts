import { areaRatiosOf } from "@/server/processing/area-ratio";
import { Prisma, type DeliveryStatus, type PaymentStatus, type PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import { canViewOrderAnalysis, redactOrderData } from "@/lib/permissions/order-analysis";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { listTimeRange, sortToOrderBy, type ListParams } from "@/lib/query-params";
import { escapeLike, normalizeSearch } from "@/lib/search";
import { TIME_PRESETS, timeRangeWhere } from "@/lib/time-presets";
import { ictYmd } from "@/lib/time";
import { DomainError } from "@/server/http/errors";
import { productOptionsByIds } from "@/server/products/queries";
import { delayDays, effectiveDeliveryStatus } from "./status";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const round2 = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
/** SL × đơn giá, làm tròn 2 số rồi LÀM TRÒN LÊN nghìn đồng (356.400 → 357.000). Cùng công thức `src/lib/line-amount.ts`. */
export const grossOf = (qty: Prisma.Decimal, price: Prisma.Decimal) => round2(qty.times(price)).div(1000).ceil().times(1000);
/** Thành tiền dòng = grossOf − chiết khấu trừ ngay. Chiết khấu tích lũy KHÔNG trừ (D-27). */
export const lineAmountOf = (l: { qty: Prisma.Decimal; salePrice: Prisma.Decimal; discountNow: Prisma.Decimal }) =>
  grossOf(l.qty, l.salePrice).minus(l.discountNow);

export const ORDER_FILTER_KEYS = ["delivery", "payment", "pending", "late", "creator", "code", "customer", "group", "stock"] as const;
export const DELIVERY_FILTER_VALUES = ["WAITING_STOCK", "READY", "LOADED", "DELIVERING", "DELIVERED", "PARTIAL", "FAILED"] as const;
const PAYMENT_VALUES = ["UNPAID", "DEPOSITED", "PARTIAL", "PAID", "DEBT", "PROMISED", "OVERPAID"] as const;

export interface OrderRowDTO {
  id: number;
  /** Người lập đơn (kế toán lọc/theo dõi đơn của mình). */
  createdByName: string | null;
  code: string;
  orderDate: Date;
  partnerId: number;
  partnerCode: string;
  partnerName: string;
  lineCount: number;
  deliveryStatus: DeliveryStatus;
  paymentStatus: PaymentStatus;
  expectedDeliveryDate: string;
  delayDays: number;
  hasProvisional: boolean;
  isCancelled: boolean;
  /** Đơn nháp (từ báo giá): chưa xuất kho, chưa công nợ. */
  isDraft: boolean;
  orderTotal?: string;
  /** Công nợ khách TRƯỚC ngày lập đơn (số đầu kỳ + sổ công nợ; dương = khách nợ). Cần `debt.view`. */
  oldDebt?: string;
  /** Nợ cũ + tiền đơn (cần `debt.view` và `sale_price.view`). */
  totalPayable?: string;
}

const ymdOf = (d: Date) => d.toISOString().slice(0, 10);

function searchWhere(q: string | undefined): Prisma.SaleOrderWhereInput {
  const terms = normalizeSearch(q ?? "").split(" ").filter(Boolean);
  if (!terms.length) return {};
  return { AND: terms.map((t) => ({ OR: [{ code: { contains: escapeLike(t.toUpperCase()) } }, { partner: { searchText: { contains: escapeLike(t) } } }] })) };
}

/** `delivery` là trạng thái HIỂN THỊ: WAITING_STOCK/READY suy ra từ cờ treo của dòng nên lọc bằng điều kiện trên dòng. */
function deliveryWhere(values: string[] | undefined): Prisma.SaleOrderWhereInput {
  const picked = (values ?? []).filter((v): v is (typeof DELIVERY_FILTER_VALUES)[number] => (DELIVERY_FILTER_VALUES as readonly string[]).includes(v));
  if (!picked.length) return {};
  const or: Prisma.SaleOrderWhereInput[] = [];
  if (picked.includes("WAITING_STOCK")) or.push({ deliveryStatus: "NEW", lines: { some: { isProvisional: true } } });
  if (picked.includes("READY")) or.push({ deliveryStatus: "NEW", lines: { none: { isProvisional: true } } });
  const stored = picked.filter((v) => v !== "WAITING_STOCK" && v !== "READY");
  if (stored.length) or.push({ deliveryStatus: { in: stored as DeliveryStatus[] } });
  return { OR: or };
}

export function orderWhere(actor: Actor, params: ListParams, now: Date): Prisma.SaleOrderWhereInput {
  const and: Prisma.SaleOrderWhereInput[] = [
    { isCancelled: false },
    { partner: partnerScopeWhere(actor) }, // phạm vi "khách của mình" áp ở tầng query
    searchWhere(params.q),
    deliveryWhere(params.filters.delivery),
  ];
  const pay = (params.filters.payment ?? []).filter((v): v is PaymentStatus => (PAYMENT_VALUES as readonly string[]).includes(v));
  if (pay.length) and.push({ paymentStatus: { in: pay } });
  const creators = (params.filters.creator ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (creators.length) and.push({ createdBy: { in: creators } });
  const code = params.filters.code?.[0]?.trim().slice(0, 200);
  if (code) and.push({ code: { contains: escapeLike(code.toUpperCase()) } });
  const customer = params.filters.customer?.[0]?.trim().slice(0, 200);
  if (customer) and.push({ partner: { AND: normalizeSearch(customer).split(" ").filter(Boolean).map((term) => ({ OR: [{ searchText: { contains: escapeLike(term) } }, { code: { contains: escapeLike(term.toUpperCase()) } }] })) } });
  const groups = (params.filters.group ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (groups.length) and.push({ partner: { groupId: { in: groups } } });
  // ASSUMPTION: stock confirmation follows isDraft; a confirmed order may still have provisional FIFO issues.
  if (params.filters.stock?.[0] === "posted") and.push({ isDraft: false });
  if (params.filters.stock?.[0] === "draft") and.push({ isDraft: true });
  if (params.filters.pending?.[0] === "1") and.push({ lines: { some: { isProvisional: true } } });
  if (params.filters.late?.[0] === "1") and.push(lateWhere(now));
  const range = listTimeRange(params, now);
  if (range) and.push({ orderDate: timeRangeWhere(range) });
  return { AND: and };
}

const lateWhere = (now: Date): Prisma.SaleOrderWhereInput => ({
  isCancelled: false, isDraft: false, deliveryStatus: { notIn: ["DELIVERED", "FAILED"] }, originalDeliveryDate: { lt: new Date(`${ictYmd(now)}T00:00:00Z`) },
});

/** Công nợ của khách ngay trước ngày lập từng đơn (trong kỳ của đơn): số đầu kỳ + Σ(nợ − có) các dòng sổ có `at` < ngày đơn. */
async function oldDebtBefore(db: Db, rows: { id: number; partnerId: number; periodId: number; orderDate: Date }[]): Promise<Map<number, Prisma.Decimal>> {
  const out = new Map<number, Prisma.Decimal>();
  await Promise.all(rows.map(async (o) => {
    const [opening, led] = await Promise.all([
      db.openingDebt.findFirst({ where: { periodId: o.periodId, partnerId: o.partnerId }, select: { amount: true } }),
      db.partnerLedger.aggregate({ where: { periodId: o.periodId, partnerId: o.partnerId, at: { lt: o.orderDate } }, _sum: { debit: true, credit: true } }),
    ]);
    out.set(o.id, D(opening?.amount ?? 0).plus(led._sum.debit ?? 0).minus(led._sum.credit ?? 0));
  }));
  return out;
}

export async function listOrders(db: Db, actor: Actor, params: ListParams, now: Date = new Date()) {
  const where = orderWhere(actor, params, now);
  const scope: Prisma.SaleOrderWhereInput = { isCancelled: false, partner: partnerScopeWhere(actor) };
  const [rows, total, all, pending, late, statuses] = await Promise.all([
    db.saleOrder.findMany({
      where, orderBy: sortToOrderBy(params.sort, ["orderDate", "code", "expectedDeliveryDate"], { orderDate: "desc" }),
      skip: (params.page - 1) * params.pageSize, take: params.pageSize,
      include: { partner: { select: { code: true, name: true } }, lines: { select: { qty: true, salePrice: true, discountNow: true, isProvisional: true } } },
    }),
    db.saleOrder.count({ where }),
    db.saleOrder.count({ where: scope }),
    db.saleOrder.count({ where: { AND: [scope, { lines: { some: { isProvisional: true } } }] } }),
    db.saleOrder.count({ where: { AND: [scope, lateWhere(now)] } }),
    db.saleOrder.groupBy({ by: ["deliveryStatus", "paymentStatus"], where: scope, _count: { _all: true } }),
  ]);
  const creatorNames = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((o) => o.createdBy))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const oldDebts = actor.perms.has("debt.view") ? await oldDebtBefore(db, rows) : null;
  const out: OrderRowDTO[] = rows.map((o) => {
    const hasProvisional = o.lines.some((l) => l.isProvisional);
    return {
      id: o.id, code: o.code, createdByName: creatorNames.get(o.createdBy) ?? null, orderDate: o.orderDate, partnerId: o.partnerId, partnerCode: o.partner.code, partnerName: o.partner.name,
      lineCount: o.lines.length, deliveryStatus: effectiveDeliveryStatus(o.deliveryStatus, hasProvisional), paymentStatus: o.paymentStatus,
      expectedDeliveryDate: ymdOf(o.expectedDeliveryDate), delayDays: delayDays(o, now), hasProvisional, isCancelled: o.isCancelled, isDraft: o.isDraft,
      orderTotal: o.lines.reduce((s, l) => s.plus(lineAmountOf(l)), D(0)).plus(o.shippingFee).toString(),
      ...(oldDebts ? { oldDebt: oldDebts.get(o.id)!.toString() } : {}),
      ...(oldDebts && actor.perms.has("sale_price.view") ? { totalPayable: o.lines.reduce((s, l) => s.plus(lineAmountOf(l)), D(0)).plus(o.shippingFee).plus(oldDebts.get(o.id)!).toString() } : {}),
    };
  });
  const delivered = statuses.filter((r) => r.deliveryStatus === "DELIVERED").reduce((s, r) => s + r._count._all, 0);
  const failed = statuses.filter((r) => r.deliveryStatus === "FAILED").reduce((s, r) => s + r._count._all, 0);
  const unpaid = statuses.filter((r) => r.paymentStatus === "UNPAID").reduce((s, r) => s + r._count._all, 0);
  return { rows: redactDeep(out, actor.perms), total, stats: { all, pending, late }, tabCounts: { all, pending, late, delivered, failed, unpaid } };
}

export interface OrderLineDTO {
  id: number; productId: number; productCode: string; productName: string; baseUnit: string;
  qty: string; unit: string; qtyBase: string; processingType: string | null; bomVersionId?: number | null;
  isProvisional: boolean; deliveredQty: string;
  /** Tỷ lệ m²/md khi dòng tính giá theo m² (kiểu gia công AREA); null = hiển thị theo md. Giá lưu vẫn là giá/md. */
  areaRatio: number | null;
  salePrice?: string; discountNow?: string; discountAccum?: string; lineAmount?: string;
  /** Ghi chú theo dòng hàng. */
  note: string | null;
  unitCostFifo?: string; lineProfit?: string | null;
  /** Định mức đã dùng (snapshot): "v2 · từ 01/10/2026". Chỉ dòng gia công. */
  bomVersionLabel?: string | null;
  /** NVL đã trừ: SL gốc, phần thiếu tồn (đơn treo) và vốn FIFO (chỉ người có cost.view thấy `materialCost`). */
  issues?: { productCode: string; productName: string; baseUnit: string; qtyBase: string; qtyProvisional: string; materialCost?: string }[];
}
export interface OrderDeliveryDTO {
  id: number; code: string; at: Date; isCancelled: boolean; note: string | null;
  lines: { orderLineId: number; productName: string; unit: string; qty: string }[];
}
export interface OrderDetailDTO extends Omit<OrderRowDTO, "lineCount" | "orderTotal"> {
  canViewAnalysis?: boolean;
  note: string | null; createdByName: string | null; walkInName: string | null; walkInPhone: string | null; shippingFee?: string; orderDiscount?: string; salesUserName: string | null; warehouseName: string | null; paymentMethod: "NONE" | "CASH" | "TRANSFER" | "COD"; cancelReason: string | null; originalDeliveryDate: string;
  lines: OrderLineDTO[]; orderTotal?: string; deliveries: OrderDeliveryDTO[];
  deposits: { id: number; code: string; at: Date; amount: string; cashAccountName: string; note: string | null; reviewed: boolean }[]; depositTotal: string;
  quote: { id: number; code: string } | null;
  history: { id: number; action: string; at: Date; userName: string | null }[];
}

export async function getOrder(db: Db, actor: Actor, id: number, now: Date = new Date()): Promise<OrderDetailDTO> {
  const o = await db.saleOrder.findFirst({
    where: { id, partner: partnerScopeWhere(actor) },
    include: {
      partner: { select: { code: true, name: true } },
      salesUser: { select: { fullName: true } }, warehouse: { select: { name: true } },
      lines: {
        orderBy: { id: "asc" },
        include: {
          product: { select: { code: true, name: true, baseUnit: true } }, processingType: { select: { name: true, priceBasis: true, ratio: true } },
          bomVersion: { select: { versionNo: true, validFrom: true } },
          issues: { orderBy: { productId: "asc" }, include: { product: { select: { code: true, name: true, baseUnit: true } } } },
          deliveryLines: { where: { deliveryNote: { isCancelled: false } }, select: { qty: true } },
        },
      },
    },
  });
  if (!o) throw new DomainError("Không tìm thấy đơn hàng.", 404);
  const notes = await db.deliveryNote.findMany({
    where: { orderId: id }, orderBy: [{ at: "asc" }, { id: "asc" }],
    include: { lines: { include: { orderLine: { select: { unit: true, product: { select: { name: true } } } } } } },
  });
  const [receipts, quoteRow] = await Promise.all([
    db.receipt.findMany({ where: { orderId: id, isCancelled: false, type: "COC" }, orderBy: [{ at: "asc" }, { id: "asc" }], include: { cashAccount: { select: { name: true } } } }),
    db.quote.findUnique({ where: { convertedOrderId: id }, select: { id: true, code: true } }),
  ]);
  const [audit, users] = await Promise.all([
    db.auditLog.findMany({ where: { entity: "SaleOrder", entityId: String(id) }, orderBy: { at: "asc" }, select: { id: true, action: true, at: true, userId: true } }),
    db.user.findMany({ where: { id: { in: [o.createdBy] } }, select: { id: true, fullName: true } }),
  ]);
  const auditUsers = new Map((await db.user.findMany({ where: { id: { in: [...new Set(audit.flatMap((a) => (a.userId === null ? [] : [a.userId])))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const hasProvisional = o.lines.some((l) => l.isProvisional);
  // Vốn + phần thiếu tồn TỪNG NVL của dòng gia công: cộng từ sổ kho (engine là nơi duy nhất ghi giá vốn)
  const bomLineIds = o.lines.filter((l) => l.bomVersionId !== null).map((l) => l.id);
  const ledgerRows = canViewOrderAnalysis(actor.perms) && bomLineIds.length
    ? await db.stockLedger.findMany({ where: { docType: "SALE", docLineId: { in: bomLineIds }, qtyOut: { gt: 0 } }, select: { docLineId: true, productId: true, qtyOut: true, unitCostOut: true, qtyProvisional: true } })
    : [];
  const perMaterial = new Map<string, { cost: Prisma.Decimal; prov: Prisma.Decimal }>();
  for (const r of ledgerRows) {
    const k = `${r.docLineId}:${r.productId}`, cur = perMaterial.get(k) ?? { cost: D(0), prov: D(0) };
    perMaterial.set(k, { cost: cur.cost.plus(r.qtyOut.times(r.unitCostOut)), prov: cur.prov.plus(r.qtyProvisional) });
  }
  const areaRatios = await areaRatiosOf(db, o.lines.map((l) => ({ productId: l.productId, unit: l.unit, baseUnit: l.product.baseUnit, note: l.note, processingTypeId: l.processingTypeId, type: l.processingType })));
  const lines: OrderLineDTO[] = o.lines.map((l, lineIdx) => {
    const amount = lineAmountOf(l);
    const profit = l.isProvisional ? null : amount.minus(l.discountAccum).minus(l.unitCostFifo.times(l.qtyBase));
    return {
      id: l.id, note: l.note, productId: l.productId, productCode: l.product.code, productName: l.product.name, baseUnit: l.product.baseUnit,
      qty: l.qty.toString(), unit: l.unit, qtyBase: l.qtyBase.toString(), processingType: l.processingType?.name ?? null, bomVersionId: l.bomVersionId,
      areaRatio: areaRatios[lineIdx] ?? null, isProvisional: l.isProvisional, deliveredQty: l.deliveryLines.reduce((s, d) => s.plus(d.qty), D(0)).toString(),
      salePrice: l.salePrice.toString(), discountNow: l.discountNow.toString(), discountAccum: l.discountAccum.toString(), lineAmount: amount.toString(),
      unitCostFifo: l.unitCostFifo.toString(), lineProfit: profit ? round2(profit).toString() : null,
      bomVersionLabel: l.bomVersion ? `Định mức v${l.bomVersion.versionNo} · từ ${ymdOf(l.bomVersion.validFrom).split("-").reverse().join("/")}` : null,
      issues: l.issues.map((i) => {
        const m = perMaterial.get(`${l.id}:${i.productId}`);
        return { productCode: i.product.code, productName: i.product.name, baseUnit: i.product.baseUnit, qtyBase: i.qtyBase.toString(), qtyProvisional: (m?.prov ?? D(0)).toString(), materialCost: round2(m?.cost ?? D(0)).toString() };
      }),
    };
  });
  const dto: OrderDetailDTO = {
    canViewAnalysis: canViewOrderAnalysis(actor.perms),
    id: o.id, code: o.code, orderDate: o.orderDate, partnerId: o.partnerId, partnerCode: o.partner.code, partnerName: o.partner.name,
    deliveryStatus: effectiveDeliveryStatus(o.deliveryStatus, hasProvisional), paymentStatus: o.paymentStatus,
    expectedDeliveryDate: ymdOf(o.expectedDeliveryDate), originalDeliveryDate: ymdOf(o.originalDeliveryDate), delayDays: delayDays(o, now),
    hasProvisional, isCancelled: o.isCancelled, isDraft: o.isDraft, note: o.note, cancelReason: o.cancelReason, createdByName: users[0]?.fullName ?? null,
    walkInName: o.walkInName, walkInPhone: o.walkInPhone, salesUserName: o.salesUser?.fullName ?? null, warehouseName: o.warehouse?.name ?? null, paymentMethod: o.paymentMethod,
    shippingFee: o.shippingFee.toString(), orderDiscount: o.orderDiscount.toString(),
    orderTotal: lines.reduce((s, l) => s.plus(l.lineAmount ?? 0), D(0)).plus(o.shippingFee).toString(), lines,
    deposits: receipts.map((r) => ({ id: r.id, code: r.code, at: r.at, amount: r.amount.toString(), cashAccountName: r.cashAccount.name, note: r.note, reviewed: r.reviewStatus === "REVIEWED" })),
    depositTotal: receipts.reduce((s, r) => s.plus(r.amount), D(0)).toString(),
    quote: quoteRow,
    deliveries: notes.map((n) => ({
      id: n.id, code: n.code, at: n.at, isCancelled: n.isCancelled, note: n.note,
      lines: n.lines.map((l) => ({ orderLineId: l.orderLineId, productName: l.orderLine.product.name, unit: l.orderLine.unit, qty: l.qty.toString() })),
    })),
    history: audit.map((a) => ({ id: a.id, action: a.action, at: a.at, userName: a.userId === null ? null : auditUsers.get(a.userId) ?? null })),
  };
  return redactOrderData(dto, actor.perms);
}

export interface PendingLineDTO {
  lineId: number; orderId: number; orderCode: string; orderDate: Date; partnerName: string; productCode: string; productName: string;
  qty: string; unit: string; qtyBase: string; baseUnit: string;
}

/** Danh sách đơn chưa đủ tồn (mã 29): dòng đang treo, cũ trước. Không có giá — chỉ số lượng. */
export async function listPendingLines(db: Db, actor: Actor, params: ListParams) {
  const where: Prisma.SaleOrderLineWhereInput = {
    isProvisional: true,
    order: { AND: [{ isCancelled: false }, { partner: partnerScopeWhere(actor) }, searchWhere(params.q)] },
  };
  const [rows, total] = await Promise.all([
    db.saleOrderLine.findMany({
      where, orderBy: [{ at: "asc" }, { id: "asc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize,
      include: { order: { select: { code: true, orderDate: true, partner: { select: { name: true } } } }, product: { select: { code: true, name: true, baseUnit: true } } },
    }),
    db.saleOrderLine.count({ where }),
  ]);
  const out: PendingLineDTO[] = rows.map((l) => ({
    lineId: l.id, orderId: l.orderId, orderCode: l.order.code, orderDate: l.order.orderDate, partnerName: l.order.partner.name,
    productCode: l.product.code, productName: l.product.name, qty: l.qty.toString(), unit: l.unit, qtyBase: l.qtyBase.toString(), baseUnit: l.product.baseUnit,
  }));
  return { rows: out, total };
}

let lastAdvanceYmd = "";
/**
 * Dời ngày giao dự kiến của đơn chưa giao xong về HÔM NAY (ICT) khi đã quá hạn; giữ `originalDeliveryDate` để tính số
 * ngày trễ. Idempotent (chạy lại cùng ngày không đổi gì). Gọi khi mở danh sách đơn: lần đầu trong ngày mới thực sự ghi.
 */
export async function advanceExpectedDeliveryDates(db: Db, now: Date = new Date()): Promise<number> {
  const today = ictYmd(now);
  if (lastAdvanceYmd === today) return 0;
  const moved = await db.saleOrder.updateMany({
    where: { isCancelled: false, isDraft: false, deliveryStatus: { notIn: ["DELIVERED", "FAILED"] }, expectedDeliveryDate: { lt: new Date(`${today}T00:00:00Z`) } },
    data: { expectedDeliveryDate: new Date(`${today}T00:00:00Z`) },
  });
  lastAdvanceYmd = today;
  return moved.count;
}
/** Chỉ dùng trong test. */
export const resetAdvanceMemo = () => { lastAdvanceYmd = ""; };

/** Dữ liệu nạp form SỬA đơn (đúng dạng `SaleOrderInput`, kèm id dòng). Chỉ gọi cho người có quyền sửa + xem giá bán. */
export async function getOrderForEdit(db: Db, actor: Actor, id: number) {
  const o = await db.saleOrder.findFirst({
    where: { id, partner: partnerScopeWhere(actor) },
    include: { partner: { select: { code: true, name: true, phone: true, address: true } }, lines: { orderBy: { id: "asc" } } },
  });
  if (!o) throw new DomainError("Không tìm thấy đơn hàng.", 404);
  if (o.isCancelled) throw new DomainError("Đơn đã hủy, không sửa được. Hãy khôi phục đơn trước.", 409);
  return {
    orderId: o.id, code: o.code, isDraft: o.isDraft,
    customer: { value: o.partnerId, label: `${o.partner.code} — ${o.partner.name}`, ...(o.partner.phone ? { hint: o.partner.phone } : {}), ...(o.partner.address ? { address: o.partner.address } : {}) },
    products: await productOptionsByIds(db, o.lines.map((l) => l.productId)),
    defaults: {
      partnerId: o.partnerId, date: ictYmd(o.orderDate), expectedDeliveryDate: ymdOf(o.expectedDeliveryDate), note: o.note ?? "",
      salesUserId: o.salesUserId, warehouseId: o.warehouseId, paymentMethod: o.paymentMethod,
      shippingFee: Number(o.shippingFee), orderDiscount: Number(o.orderDiscount),
      lines: o.lines.map((l) => ({
        id: l.id, productId: l.productId, unit: l.unit, qty: Number(l.qty), salePrice: Number(l.salePrice),
        discountNow: Number(l.discountNow.minus(l.discountOrder)), discountAccum: Number(l.discountAccum), processingTypeId: l.processingTypeId, issueMode: l.issueMode as "LEGACY" | "STOCK" | "BOM", note: l.note ?? "",
      })),
    },
  };
}

export interface DeletedOrderDTO {
  id: number; code: string; orderDate: Date; partnerName: string; cancelledAt: Date | null; cancelReason: string | null;
  cancelledByName: string | null; orderTotal?: string;
}

/** Danh sách đơn đã hủy (mã 34): xem lý do, ai hủy, khôi phục. */
export async function listDeletedOrders(db: Db, actor: Actor, params: ListParams, now = new Date()) {
  const terms = (params.q ?? "").trim().split(/\s+/).filter(Boolean);
  const baseWhere: Prisma.SaleOrderWhereInput = { AND: [
    { isCancelled: true }, { partner: partnerScopeWhere(actor) },
    ...terms.map((t) => ({ OR: [{ code: { contains: escapeLike(t.toUpperCase()) } }, { partner: { searchText: { contains: escapeLike(normalizeSearch(t)) } } }, { cancelReason: { contains: escapeLike(t), mode: "insensitive" as const } }] })),
    ...(params.filters.customer?.length ? [{ partnerId: { in: params.filters.customer.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0) } }] : []),
  ] };
  const range = listTimeRange(params, now);
  const where: Prisma.SaleOrderWhereInput = { AND: [baseWhere, ...(range ? [{ cancelledAt: timeRangeWhere(range) }] : [])] };
  const [rows, total] = await Promise.all([
    db.saleOrder.findMany({
      where, orderBy: { cancelledAt: "desc" }, skip: (params.page - 1) * params.pageSize, take: params.pageSize,
      include: { partner: { select: { name: true } }, lines: { select: { qty: true, salePrice: true, discountNow: true } } },
    }),
    db.saleOrder.count({ where }),
  ]);
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => (r.cancelledBy === null ? [] : [r.cancelledBy])))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const out: DeletedOrderDTO[] = rows.map((o) => ({
    id: o.id, code: o.code, orderDate: o.orderDate, partnerName: o.partner.name, cancelledAt: o.cancelledAt, cancelReason: o.cancelReason,
    cancelledByName: o.cancelledBy === null ? null : users.get(o.cancelledBy) ?? null,
    orderTotal: o.lines.reduce((s, l) => s.plus(lineAmountOf(l)), D(0)).toString(),
  }));
  const [amountRows, customers, presetCounts] = await Promise.all([
    actor.perms.has("sale_price.view") ? db.saleOrderLine.groupBy({ by: ["qty", "salePrice", "discountNow"], where: { order: where }, _count: { _all: true } }) : Promise.resolve(null),
    db.partner.findMany({ where: { AND: [partnerScopeWhere(actor), { saleOrders: { some: { isCancelled: true } } }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    Promise.all([{ value: "all" }, ...TIME_PRESETS.filter((p) => p.value !== "custom")].map(async (preset) => {
      const r = preset.value === "all" ? null : listTimeRange({ ...params, timePreset: preset.value as ListParams["timePreset"] }, now);
      return [preset.value, await db.saleOrder.count({ where: { AND: [baseWhere, ...(r ? [{ cancelledAt: timeRangeWhere(r) }] : [])] } })] as const;
    })),
  ]);
  const amount = amountRows?.reduce((sum, line) => sum.plus(lineAmountOf(line).times(line._count._all)), D(0)).toString();
  return { rows: redactDeep(out, actor.perms), total, amount, customers, counts: Object.fromEntries(presetCounts) };
}

/** Người đã lập đơn (cho bộ lọc "Người tạo" của danh sách đơn). */
export async function listOrderCreators(db: Db): Promise<{ value: string; label: string }[]> {
  const ids = (await db.saleOrder.findMany({ distinct: ["createdBy"], select: { createdBy: true } })).map((r) => r.createdBy);
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } });
  return users.map((u) => ({ value: String(u.id), label: u.fullName }));
}
