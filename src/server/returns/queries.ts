import { Prisma, type PrismaClient, type ReturnKind } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { sortToOrderBy, type ListParams } from "@/lib/query-params";
import { escapeLike, normalizeSearch } from "@/lib/search";
import { DomainError } from "@/server/http/errors";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export const RETURN_FILTER_KEYS = ["state"] as const;

/**
 * Tên trường nhạy cảm THEO LOẠI: khách → returnTotal/salePrice/lineAmount (sale_price.view); NCC → purchaseTotal/
 * purchasePrice/purchaseAmount (purchase_price.view). Đặt đúng tên đã đăng ký để redactDeep tự gỡ khi thiếu quyền.
 */
export interface ReturnRowDTO {
  id: number; code: string; kind: ReturnKind; at: Date; partnerCode: string; partnerName: string; orderId: number | null; orderCode: string | null;
  lineCount: number; isCancelled: boolean; returnTotal?: string; purchaseTotal?: string;
}
export interface ReturnDetailDTO extends Omit<ReturnRowDTO, "lineCount"> {
  note: string | null; cancelReason: string | null; createdByName: string | null;
  /** Khấu trừ khi khách trả (cần sale_price.view) và các khoản đã hoàn lại cho khách. */
  returnDeduction?: string; deductionNote?: string | null;
  refunds?: { id: number; code: string; refundAmount: string; accountName: string; isCancelled: boolean }[];
  lines: { id: number; productCode: string; productName: string; unit: string; qty: string; salePrice?: string; lineAmount?: string; purchasePrice?: string; purchaseAmount?: string }[];
}

function where(actor: Actor, kinds: ReturnKind[], params: ListParams): Prisma.GoodsReturnWhereInput {
  const terms = normalizeSearch(params.q ?? "").split(" ").filter(Boolean);
  const state = params.filters.state ?? [];
  return {
    AND: [
      { kind: { in: kinds } },
      ...(kinds.includes("SUPPLIER") ? [] : [{ partner: partnerScopeWhere(actor) }]),
      ...(state.length === 1 ? [{ isCancelled: state[0] === "cancelled" }] : []),
      ...terms.map((t) => ({ OR: [{ code: { contains: escapeLike(t.toUpperCase()) } }, { order: { code: { contains: escapeLike(t.toUpperCase()) } } }, { partner: { searchText: { contains: escapeLike(t) } } }] })),
    ],
  };
}

export async function listReturns(db: Db, actor: Actor, kinds: ReturnKind[], params: ListParams) {
  const w = where(actor, kinds, params);
  const [rows, total] = await Promise.all([
    db.goodsReturn.findMany({
      where: w, orderBy: sortToOrderBy(params.sort, ["at", "code"], { at: "desc" }), skip: (params.page - 1) * params.pageSize, take: params.pageSize,
      include: { partner: { select: { code: true, name: true } }, order: { select: { code: true } }, _count: { select: { lines: true } } },
    }),
    db.goodsReturn.count({ where: w }),
  ]);
  const out: ReturnRowDTO[] = rows.map((r) => ({
    id: r.id, code: r.code, kind: r.kind, at: r.at, partnerCode: r.partner.code, partnerName: r.partner.name, orderId: r.orderId, orderCode: r.order?.code ?? null,
    lineCount: r._count.lines, isCancelled: r.isCancelled,
    ...(r.kind === "SUPPLIER" ? { purchaseTotal: r.totalAmount.toString() } : { returnTotal: r.totalAmount.toString() }),
  }));
  return { rows: redactDeep(out, actor.perms), total };
}

export async function getReturn(db: Db, actor: Actor, id: number): Promise<ReturnDetailDTO> {
  const r = await db.goodsReturn.findUnique({
    where: { id },
    include: { partner: { select: { code: true, name: true } }, order: { select: { code: true } }, refunds: { orderBy: { id: "asc" }, select: { id: true, code: true, amount: true, isCancelled: true, cashAccount: { select: { name: true } } } }, lines: { orderBy: { id: "asc" }, include: { product: { select: { code: true, name: true } } } } },
  });
  // Ngoài phạm vi "khách của mình" trả cùng lỗi như không tồn tại
  const visible = r && (r.kind === "SUPPLIER" || (await db.partner.count({ where: { id: r.partnerId, ...partnerScopeWhere(actor) } })) > 0);
  if (!r || !visible) throw new DomainError("Không tìm thấy phiếu trả hàng.", 404);
  const creator = await db.user.findUnique({ where: { id: r.createdBy }, select: { fullName: true } });
  const supplier = r.kind === "SUPPLIER";
  const dto: ReturnDetailDTO = {
    id: r.id, code: r.code, kind: r.kind, at: r.at, partnerCode: r.partner.code, partnerName: r.partner.name, orderId: r.orderId, orderCode: r.order?.code ?? null,
    isCancelled: r.isCancelled, note: r.note, cancelReason: r.cancelReason, createdByName: creator?.fullName ?? null,
    ...(supplier ? { purchaseTotal: r.totalAmount.toString() } : { returnTotal: r.totalAmount.toString(), returnDeduction: r.deductionAmount.toString(), deductionNote: r.deductionNote }),
    refunds: r.refunds.map((p) => ({ id: p.id, code: p.code, refundAmount: p.amount.toString(), accountName: p.cashAccount.name, isCancelled: p.isCancelled })),
    lines: r.lines.map((l) => ({
      id: l.id, productCode: l.product.code, productName: l.product.name, unit: l.unit, qty: l.qty.toString(),
      ...(supplier ? { purchasePrice: l.unitPrice.toString(), purchaseAmount: l.amount.toString() } : { salePrice: l.unitPrice.toString(), lineAmount: l.amount.toString() }),
    })),
  };
  return redactDeep(dto, actor.perms);
}

/** Đơn có thể trả (đã giao ít nhất một phần), tìm theo mã đơn / khách — cho bước chọn đơn ở màn 43. */
export async function searchReturnableOrders(db: Db, actor: Actor, q: string) {
  const terms = normalizeSearch(q).split(" ").filter(Boolean);
  const rows = await db.saleOrder.findMany({
    where: {
      isCancelled: false, isDraft: false, partner: partnerScopeWhere(actor), deliveryStatus: { in: ["PARTIAL", "DELIVERED"] },
      AND: terms.map((t) => ({ OR: [{ code: { contains: escapeLike(t.toUpperCase()) } }, { partner: { searchText: { contains: escapeLike(t) } } }] })),
    },
    orderBy: [{ orderDate: "desc" }, { id: "desc" }], take: 20,
    select: { id: true, code: true, orderDate: true, partner: { select: { code: true, name: true } } },
  });
  return rows.map((o) => ({ id: o.id, code: o.code, orderDate: o.orderDate, partnerCode: o.partner.code, partnerName: o.partner.name }));
}

export interface ReturnableOrderDTO {
  id: number; code: string; partnerName: string; partnerCode: string; orderDate: Date;
  lines: { id: number; productCode: string; productName: string; unit: string; delivered: string; returned: string; remaining: string; returnable: boolean }[];
}
/** Các dòng của một đơn kèm SL đã giao / đã trả / còn trả được (cho form trả theo đơn). */
export async function getOrderForReturn(db: Db, actor: Actor, orderId: number): Promise<ReturnableOrderDTO> {
  const o = await db.saleOrder.findFirst({
    where: { id: orderId, partner: partnerScopeWhere(actor) },
    include: {
      partner: { select: { code: true, name: true } },
      lines: {
        orderBy: { id: "asc" },
        include: {
          product: { select: { code: true, name: true } },
          deliveryLines: { where: { deliveryNote: { isCancelled: false } }, select: { qty: true } },
          returnLines: { where: { goodsReturn: { isCancelled: false } }, select: { qty: true } },
        },
      },
    },
  });
  if (!o) throw new DomainError("Không tìm thấy đơn hàng.", 404);
  if (o.isCancelled || o.isDraft) throw new DomainError("Đơn đã hủy hoặc còn là nháp, không trả hàng được.", 409);
  return {
    id: o.id, code: o.code, partnerName: o.partner.name, partnerCode: o.partner.code, orderDate: o.orderDate,
    lines: o.lines.map((l) => {
      const delivered = l.deliveryLines.reduce((s, d) => s.plus(d.qty), D(0));
      const returned = l.returnLines.reduce((s, d) => s.plus(d.qty), D(0));
      return {
        id: l.id, productCode: l.product.code, productName: l.product.name, unit: l.unit, delivered: delivered.toString(), returned: returned.toString(),
        remaining: delivered.minus(returned).toString(), returnable: l.processingTypeId === null,
      };
    }),
  };
}
