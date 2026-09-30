import { Prisma, type PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { getDebtDetail } from "@/server/debt/queries";
import { lineAmountOf } from "@/server/sales/queries";
import { PAYMENT_LABEL } from "@/server/sales/status";

/** Dữ liệu các tab “Công nợ / Lịch sử mua hàng / Báo giá & đơn hàng / Lịch sử nhập hàng” của màn chi tiết đối tác. Mỗi khối `null` = không đủ quyền hoặc không áp dụng. */
export interface PartnerActivityDTO {
  debt: null | { balance: string; opening: string; discountBalance: string; entries: { id: number; at: string; docLabel: string; docCode: string | null; docHref: string | null; debit: string; credit: string; running: string }[]; total: number };
  /** Đơn đã giao xong (lịch sử mua hàng) — khách hàng */
  history: null | { id: number; code: string; at: string; total: string | null; payment: string }[];
  /** Báo giá + đơn còn đang xử lý — khách hàng */
  pipeline: null | { quotes: { id: number; code: string; at: string; status: string }[]; orders: { id: number; code: string; at: string; delivery: string; total: string | null }[] };
  /** Phiếu nhập từ NCC */
  purchases: null | { id: number; code: string; at: string; total: string | null }[];
}

const LIMIT = 20;
const QUOTE_LABEL: Record<string, string> = { DRAFT: "Nháp", SENT: "Đã gửi", CONVERTED: "Đã chuyển thành đơn", CANCELLED: "Đã hủy" };

export async function getPartnerActivity(db: PrismaClient, actor: Actor, partner: { id: number; isCustomer: boolean; isSupplier: boolean }): Promise<PartnerActivityDTO> {
  const has = (p: string) => actor.perms.has(p);
  const out: PartnerActivityDTO = { debt: null, history: null, pipeline: null, purchases: null };

  if (has("debt.view")) {
    const d = await getDebtDetail(db, actor, partner.id, { ...parseListParams({}, []), page: 1, pageSize: 10 });
    out.debt = { balance: d.balance, opening: d.opening, discountBalance: d.discountBalance, total: d.total, entries: d.entries.map((e) => ({ id: e.id, at: e.at.toISOString(), docLabel: e.docLabel, docCode: e.docCode, docHref: e.docHref, debit: e.debit, credit: e.credit, running: e.running })) };
  }

  if (partner.isCustomer && has("order.view")) {
    const showPrice = has("sale_price.view");
    const orders = await db.saleOrder.findMany({
      where: { partnerId: partner.id, isCancelled: false, isDraft: false }, orderBy: [{ orderDate: "desc" }, { id: "desc" }], take: 200,
      include: { lines: { select: { qty: true, salePrice: true, discountNow: true } } },
    });
    const total = (o: (typeof orders)[number]) => (showPrice ? o.lines.reduce((s, l) => s.plus(lineAmountOf(l)), new Prisma.Decimal(0)).toString() : null);
    out.history = orders.filter((o) => o.deliveryStatus === "DELIVERED").slice(0, LIMIT).map((o) => ({ id: o.id, code: o.code, at: o.orderDate.toISOString(), total: total(o), payment: PAYMENT_LABEL[o.paymentStatus].label }));
    const open = orders.filter((o) => o.deliveryStatus !== "DELIVERED").slice(0, LIMIT);
    const quotes = has("quote.manage") ? await db.quote.findMany({ where: { partnerId: partner.id, status: { not: "CANCELLED" } }, orderBy: [{ at: "desc" }, { id: "desc" }], take: LIMIT, select: { id: true, code: true, at: true, status: true } }) : [];
    out.pipeline = {
      quotes: quotes.map((q) => ({ id: q.id, code: q.code, at: q.at.toISOString(), status: QUOTE_LABEL[q.status] ?? q.status })),
      orders: open.map((o) => ({ id: o.id, code: o.code, at: o.orderDate.toISOString(), delivery: o.deliveryStatus, total: total(o) })),
    };
  }

  if (partner.isSupplier && has("purchase.view")) {
    const showPrice = has("purchase_price.view");
    const rows = await db.purchase.findMany({ where: { partnerId: partner.id, isCancelled: false }, orderBy: [{ at: "desc" }, { id: "desc" }], take: LIMIT, select: { id: true, code: true, at: true, purchaseTotal: true } });
    out.purchases = rows.map((r) => ({ id: r.id, code: r.code, at: r.at.toISOString(), total: showPrice ? r.purchaseTotal.toString() : null }));
  }
  return out;
}
