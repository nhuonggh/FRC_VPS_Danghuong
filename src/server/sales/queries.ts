import { Prisma, type DeliveryStatus, type PaymentStatus, type PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { listTimeRange, sortToOrderBy, type ListParams } from "@/lib/query-params";
import { escapeLike, normalizeSearch } from "@/lib/search";
import { timeRangeWhere } from "@/lib/time-presets";
import { ictYmd } from "@/lib/time";
import { DomainError } from "@/server/http/errors";
import { delayDays, effectiveDeliveryStatus } from "./status";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const round2 = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
/** Thành tiền dòng = SL × đơn giá (làm tròn 2 số) − chiết khấu trừ ngay. Chiết khấu tích lũy KHÔNG trừ (D-27). */
export const lineAmountOf = (l: { qty: Prisma.Decimal; salePrice: Prisma.Decimal; discountNow: Prisma.Decimal }) =>
  round2(l.qty.times(l.salePrice)).minus(l.discountNow);

export const ORDER_FILTER_KEYS = ["delivery", "payment", "pending", "late"] as const;
export const DELIVERY_FILTER_VALUES = ["WAITING_STOCK", "READY", "LOADED", "DELIVERING", "DELIVERED", "PARTIAL", "FAILED"] as const;
const PAYMENT_VALUES = ["UNPAID", "DEPOSITED", "PARTIAL", "PAID", "DEBT", "PROMISED", "OVERPAID"] as const;

export interface OrderRowDTO {
  id: number;
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
  orderTotal?: string;
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
  if (params.filters.pending?.[0] === "1") and.push({ lines: { some: { isProvisional: true } } });
  if (params.filters.late?.[0] === "1") and.push(lateWhere(now));
  const range = listTimeRange(params, now);
  if (range) and.push({ orderDate: timeRangeWhere(range) });
  return { AND: and };
}

const lateWhere = (now: Date): Prisma.SaleOrderWhereInput => ({
  isCancelled: false, deliveryStatus: { notIn: ["DELIVERED", "FAILED"] }, originalDeliveryDate: { lt: new Date(`${ictYmd(now)}T00:00:00Z`) },
});

export async function listOrders(db: Db, actor: Actor, params: ListParams, now: Date = new Date()) {
  const where = orderWhere(actor, params, now);
  const scope: Prisma.SaleOrderWhereInput = { isCancelled: false, partner: partnerScopeWhere(actor) };
  const [rows, total, all, pending, late] = await Promise.all([
    db.saleOrder.findMany({
      where, orderBy: sortToOrderBy(params.sort, ["orderDate", "code", "expectedDeliveryDate"], { orderDate: "desc" }),
      skip: (params.page - 1) * params.pageSize, take: params.pageSize,
      include: { partner: { select: { code: true, name: true } }, lines: { select: { qty: true, salePrice: true, discountNow: true, isProvisional: true } } },
    }),
    db.saleOrder.count({ where }),
    db.saleOrder.count({ where: scope }),
    db.saleOrder.count({ where: { AND: [scope, { lines: { some: { isProvisional: true } } }] } }),
    db.saleOrder.count({ where: { AND: [scope, lateWhere(now)] } }),
  ]);
  const out: OrderRowDTO[] = rows.map((o) => {
    const hasProvisional = o.lines.some((l) => l.isProvisional);
    return {
      id: o.id, code: o.code, orderDate: o.orderDate, partnerId: o.partnerId, partnerCode: o.partner.code, partnerName: o.partner.name,
      lineCount: o.lines.length, deliveryStatus: effectiveDeliveryStatus(o.deliveryStatus, hasProvisional), paymentStatus: o.paymentStatus,
      expectedDeliveryDate: ymdOf(o.expectedDeliveryDate), delayDays: delayDays(o, now), hasProvisional, isCancelled: o.isCancelled,
      orderTotal: o.lines.reduce((s, l) => s.plus(lineAmountOf(l)), D(0)).toString(),
    };
  });
  return { rows: redactDeep(out, actor.perms), total, stats: { all, pending, late } };
}

export interface OrderLineDTO {
  id: number; productId: number; productCode: string; productName: string; baseUnit: string;
  qty: string; unit: string; qtyBase: string; processingType: string | null; bomVersionId: number | null;
  isProvisional: boolean; deliveredQty: string;
  salePrice?: string; discountNow?: string; discountAccum?: string; lineAmount?: string;
  unitCostFifo?: string; lineProfit?: string | null;
  issues: { productCode: string; productName: string; qtyBase: string }[];
}
export interface OrderDetailDTO extends Omit<OrderRowDTO, "lineCount" | "orderTotal"> {
  note: string | null; createdByName: string | null; cancelReason: string | null; originalDeliveryDate: string;
  lines: OrderLineDTO[]; orderTotal?: string;
  history: { id: number; action: string; at: Date; userName: string | null }[];
}

export async function getOrder(db: Db, actor: Actor, id: number, now: Date = new Date()): Promise<OrderDetailDTO> {
  const o = await db.saleOrder.findFirst({
    where: { id, partner: partnerScopeWhere(actor) },
    include: {
      partner: { select: { code: true, name: true } },
      lines: {
        orderBy: { id: "asc" },
        include: {
          product: { select: { code: true, name: true, baseUnit: true } }, processingType: { select: { name: true } },
          issues: { orderBy: { productId: "asc" }, include: { product: { select: { code: true, name: true } } } },
          deliveryLines: { where: { deliveryNote: { isCancelled: false } }, select: { qty: true } },
        },
      },
    },
  });
  if (!o) throw new DomainError("Không tìm thấy đơn hàng.", 404);
  const [audit, users] = await Promise.all([
    db.auditLog.findMany({ where: { entity: "SaleOrder", entityId: String(id) }, orderBy: { at: "asc" }, select: { id: true, action: true, at: true, userId: true } }),
    db.user.findMany({ where: { id: { in: [o.createdBy] } }, select: { id: true, fullName: true } }),
  ]);
  const auditUsers = new Map((await db.user.findMany({ where: { id: { in: [...new Set(audit.flatMap((a) => (a.userId === null ? [] : [a.userId])))] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const hasProvisional = o.lines.some((l) => l.isProvisional);
  const lines: OrderLineDTO[] = o.lines.map((l) => {
    const amount = lineAmountOf(l);
    const profit = l.isProvisional ? null : amount.minus(l.discountAccum).minus(l.unitCostFifo.times(l.qtyBase));
    return {
      id: l.id, productId: l.productId, productCode: l.product.code, productName: l.product.name, baseUnit: l.product.baseUnit,
      qty: l.qty.toString(), unit: l.unit, qtyBase: l.qtyBase.toString(), processingType: l.processingType?.name ?? null, bomVersionId: l.bomVersionId,
      isProvisional: l.isProvisional, deliveredQty: l.deliveryLines.reduce((s, d) => s.plus(d.qty), D(0)).toString(),
      salePrice: l.salePrice.toString(), discountNow: l.discountNow.toString(), discountAccum: l.discountAccum.toString(), lineAmount: amount.toString(),
      unitCostFifo: l.unitCostFifo.toString(), lineProfit: profit ? round2(profit).toString() : null,
      issues: l.issues.map((i) => ({ productCode: i.product.code, productName: i.product.name, qtyBase: i.qtyBase.toString() })),
    };
  });
  const dto: OrderDetailDTO = {
    id: o.id, code: o.code, orderDate: o.orderDate, partnerId: o.partnerId, partnerCode: o.partner.code, partnerName: o.partner.name,
    deliveryStatus: effectiveDeliveryStatus(o.deliveryStatus, hasProvisional), paymentStatus: o.paymentStatus,
    expectedDeliveryDate: ymdOf(o.expectedDeliveryDate), originalDeliveryDate: ymdOf(o.originalDeliveryDate), delayDays: delayDays(o, now),
    hasProvisional, isCancelled: o.isCancelled, note: o.note, cancelReason: o.cancelReason, createdByName: users[0]?.fullName ?? null,
    orderTotal: lines.reduce((s, l) => s.plus(l.lineAmount ?? 0), D(0)).toString(), lines,
    history: audit.map((a) => ({ id: a.id, action: a.action, at: a.at, userName: a.userId === null ? null : auditUsers.get(a.userId) ?? null })),
  };
  return redactDeep(dto, actor.perms);
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
    where: { isCancelled: false, deliveryStatus: { notIn: ["DELIVERED", "FAILED"] }, expectedDeliveryDate: { lt: new Date(`${today}T00:00:00Z`) } },
    data: { expectedDeliveryDate: new Date(`${today}T00:00:00Z`) },
  });
  lastAdvanceYmd = today;
  return moved.count;
}
/** Chỉ dùng trong test. */
export const resetAdvanceMemo = () => { lastAdvanceYmd = ""; };
