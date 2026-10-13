import { Prisma, type PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { formatCurrency, formatDate, formatDateTime, formatQty } from "@/lib/format";
import { pricePerM2 } from "@/lib/length-expr";
import { getDebtDetail } from "@/server/debt/queries";
import { DomainError } from "@/server/http/errors";
import { orderPaid } from "@/server/deposits/status";
import { getPurchase } from "@/server/purchase/queries";
import { getQuote } from "@/server/quotes/queries";
import { getOrder } from "@/server/sales/queries";
import { getVoucher } from "@/server/cash/queries";
import { getTrip } from "@/server/trips/queries";
import { partnerScopeWhere } from "@/lib/permissions/scope";
import type { ContractBody } from "./types";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const money = (v: string | undefined | null) => (v === undefined || v === null || v === "" ? "" : formatCurrency(v));
/** Dòng tính giá theo m² (kiểu gia công AREA): in SL (m²), ĐVT m², đơn giá/m²; giá lưu là giá/md nên thành tiền không đổi. */
const areaView = (qty: string, unit: string, price: string | undefined, ratio: number | null) => (ratio ? { qty: formatQty(String(Math.round(Number(qty) * ratio * 1000) / 1000)), unit: "m²", price: money(price === undefined ? undefined : String(pricePerM2(Number(price), ratio))) } : { qty: formatQty(qty), unit, price: money(price) });
const sum = (rows: (string | undefined)[]) => rows.reduce((s, v) => s.plus(v ?? 0), D(0)).toString();
const partnerOf = async (db: Db, partnerId: number | null) => {
  if (partnerId === null) return null;
  const p = await db.partner.findUnique({ where: { id: partnerId }, select: { code: true, name: true, phone: true, address: true } });
  return p ? { code: p.code, name: p.name, phone: p.phone ?? "", address: p.address ?? "" } : null;
};

/**
 * Dựng data contract (phần theo loại chứng từ) từ các DTO đã có — mọi trường nhạy cảm đi qua CÙNG bộ lọc quyền của màn hình
 * (giá bán/giá nhập chỉ có khi người in có quyền; KHÔNG BAO GIỜ đưa giá vốn/lãi vào bản in).
 */
export async function buildContract(db: Db, actor: Actor, docType: string, docId: number, now: Date = new Date()): Promise<ContractBody> {
  switch (docType) {
    case "SALE_INVOICE": {
      const o = await getOrder(db, actor, docId, now);
      if (o.isDraft) throw new DomainError("Đơn nháp chưa xác nhận — chưa in hóa đơn được.", 409);
      const lines = o.lines.map((l, i) => ({
        no: String(i + 1), code: l.productCode, name: l.productName, ...areaView(l.qty, l.unit, l.salePrice, l.areaRatio),
        discountNow: money(l.discountNow), discountAccum: money(l.discountAccum), amount: money(l.lineAmount), processing: l.processingType ?? "", note: l.note ?? "",
      }));
      const total = o.orderTotal ?? "0"; const deposit = (await orderPaid(db, docId)).toString(); // cọc + thu nợ theo đơn + tiền lái xe đã thu
      return {
        docCode: o.code, partner: await partnerOf(db, o.partnerId),
        doc: { code: o.code, date: formatDate(o.orderDate), expectedDelivery: formatDate(o.expectedDeliveryDate), note: o.note ?? "", createdBy: o.createdByName ?? "", status: o.isCancelled ? "ĐÃ HỦY" : "" },
        lines,
        totals: { shippingFee: money(o.shippingFee ?? "0"), orderDiscount: money(o.orderDiscount ?? "0"), discountNow: money(sum(o.lines.map((l) => l.discountNow))), discountAccum: money(sum(o.lines.map((l) => l.discountAccum))), total: money(total), deposit: money(o.depositTotal), paid: money(deposit), remaining: money(D(total).minus(deposit).toString()) },
      };
    }
    case "QUOTE": {
      const q = await getQuote(db, actor, docId);
      const partner = await db.quote.findUnique({ where: { id: docId }, select: { partnerId: true } });
      return {
        docCode: q.code, partner: await partnerOf(db, partner?.partnerId ?? null),
        doc: { code: q.code, date: formatDate(q.at), note: q.note ?? "", status: q.status, createdBy: q.createdByName ?? "" },
        lines: q.lines.map((l, i) => ({ no: String(i + 1), code: l.productCode, name: l.productName, ...areaView(l.qty, l.unit, l.salePrice, l.areaRatio), amount: money(l.lineAmount), note: l.note ?? "", processing: l.processingTypeName ?? "" })),
        totals: { total: money(q.quoteTotal) },
      };
    }
    case "DELIVERY_NOTE": {
      const n = await db.deliveryNote.findFirst({
        where: { id: docId, order: { partner: partnerScopeWhere(actor) } },
        include: { order: { select: { code: true, partnerId: true, note: true } }, lines: { include: { orderLine: { include: { product: { select: { code: true, name: true } }, processingType: { select: { name: true } } } } } } },
      });
      if (!n) throw new DomainError("Không tìm thấy phiếu giao.", 404);
      return {
        docCode: n.code, partner: await partnerOf(db, n.order.partnerId),
        doc: { code: n.code, orderCode: n.order.code, date: formatDateTime(n.at), note: n.note ?? "", status: n.isCancelled ? "ĐÃ HỦY" : "" },
        lines: n.lines.map((l, i) => ({ no: String(i + 1), code: l.orderLine.product.code, name: l.orderLine.product.name, unit: l.orderLine.unit, qty: formatQty(l.qty.toString()), processing: l.orderLine.processingType?.name ?? "" })),
        totals: { totalQty: formatQty(n.lines.reduce((s, l) => s.plus(l.qty), D(0)).toString()) },
      };
    }
    case "RECEIPT":
    case "PAYMENT": {
      const v = await getVoucher(db, actor, docType, docId);
      return {
        docCode: v.code, partner: await partnerOf(db, v.partnerId),
        doc: { code: v.code, type: v.typeLabel, date: formatDate(v.at), account: v.cashAccountName, order: v.orderCode ?? "", note: v.note ?? "", createdBy: v.createdByName ?? "", status: v.isCancelled ? "ĐÃ HỦY" : "" },
        lines: [], totals: { amount: money(v.amount), amountInWords: "" },
      };
    }
    case "PURCHASE_RECEIPT": {
      const p = await getPurchase(db, actor, docId);
      return {
        docCode: p.code, partner: await partnerOf(db, p.partnerId),
        doc: { code: p.code, date: formatDate(p.at), note: p.note ?? "", createdBy: p.createdByName ?? "", status: p.isCancelled ? "ĐÃ HỦY" : "" },
        lines: p.lines.map((l, i) => ({ no: String(i + 1), code: l.productCode, name: l.productName, ...areaView(l.qty, l.unit, l.purchasePrice, l.areaRatio), amount: money(l.purchaseAmount), rollInfo: l.rollInfo ?? "", processing: l.processingTypeName ?? "" })),
        totals: { freight: money(p.freightCost), total: money(p.purchaseTotal) },
      };
    }
    case "DEBT_STATEMENT": {
      const d = await getDebtDetail(db, actor, docId, { page: 1, pageSize: 500, filters: {} });
      const asc = [...d.entries].reverse();
      return {
        docCode: d.partner.code, partner: await partnerOf(db, d.partner.id),
        doc: { code: d.partner.code, date: formatDate(now), note: d.total > d.entries.length ? `Chỉ in ${d.entries.length}/${d.total} dòng mới nhất` : "" },
        lines: asc.map((e, i) => ({ no: String(i + 1), date: formatDate(e.at), docLabel: e.docLabel, docCode: e.docCode ?? "", debit: Number(e.debit) ? money(e.debit) : "", credit: Number(e.credit) ? money(e.credit) : "", running: money(e.running) })),
        totals: { opening: money(d.opening), debit: money(d.debit), credit: money(d.credit), balance: money(d.balance), discountBalance: money(d.discountBalance) },
      };
    }
    case "TRIP_SHEET": {
      const t = await getTrip(db, actor, docId);
      return {
        docCode: t.code, partner: null,
        doc: { code: t.code, date: formatDate(t.date), vehicle: t.vehiclePlate, driver: t.driverName, assistant: t.assistantName ?? "", route: t.routeName ?? "", note: t.note ?? "", status: t.statusLabel },
        lines: t.stops.flatMap((s) => s.lines.filter((l) => Number(l.remaining) > 0 || s.result).map((l, i) => ({ stop: String(s.seq), order: s.orderCode, customer: s.partnerName, phone: s.phone ?? "", address: s.address ?? "", no: String(i + 1), code: l.productCode, name: l.productName, unit: l.unit, qty: formatQty(l.remaining), due: i === 0 ? money(s.suggestedDue) : "" }))),
        totals: { stops: String(t.stops.length) },
      };
    }
    default:
      throw new DomainError("Loại chứng từ này chưa hỗ trợ in.", 409, "PRINT_UNSUPPORTED");
  }
}
