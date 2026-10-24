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
import { getReturn } from "@/server/returns/queries";
import { getProductionOrder } from "@/server/production/queries";
import { LOSS_TYPE_LABEL } from "@/server/stock-adjust/schemas";
import { getLossAdjust } from "@/server/stock-adjust/service";
import { SETTLE_METHOD_LABEL } from "@/server/discount/schemas";
import { orderInclude, progress } from "@/server/supplier-orders/service";
import { getStocktake, STOCKTAKE_LABEL } from "@/server/stocktake/queries";
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
/** `range`: khoảng ngày (yyyy-mm-dd, gồm cả hai đầu) — hiện chỉ dùng cho đối chiếu công nợ. */
export async function buildContract(db: Db, actor: Actor, docType: string, docId: number, now: Date = new Date(), range?: { from: string; to: string }): Promise<ContractBody> {
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
        include: { order: { select: { code: true, partnerId: true, note: true } }, lines: { orderBy: { id: "asc" }, include: { orderLine: { include: { product: { select: { code: true, name: true } }, processingType: { select: { name: true } } } } } } },
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
        doc: { code: v.code, type: v.typeLabel, date: formatDateTime(v.at), account: v.cashAccountName, order: v.orderCode ?? "", note: v.note ?? "", createdBy: v.createdByName ?? "", status: v.isCancelled ? "ĐÃ HỦY" : "" },
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
      const d = await getDebtDetail(db, actor, docId, { page: 1, pageSize: 500, filters: {}, ...(range ? { timePreset: "custom", timeStart: range.from, timeEnd: range.to } : {}) });
      const asc = [...d.entries].reverse();
      return {
        docCode: d.partner.code, partner: await partnerOf(db, d.partner.id),
        doc: { code: d.partner.code, date: formatDate(now), period: d.range ? `Từ ${formatDate(d.range.start)} đến ${formatDate(new Date(d.range.end.getTime() - 1))}` : "", note: d.total > d.entries.length ? `Chỉ in ${d.entries.length}/${d.total} dòng mới nhất` : "" },
        lines: asc.map((e, i) => ({ no: String(i + 1), date: formatDate(e.at), docLabel: e.docLabel, docCode: e.docCode ?? "", debit: Number(e.debit) ? money(e.debit) : "", credit: Number(e.credit) ? money(e.credit) : "", running: money(e.running) })),
        totals: { opening: money(d.opening), debit: money(d.debit), credit: money(d.credit), balance: money(d.balance), discountBalance: money(d.discountBalance) },
      };
    }
    case "TRIP_SHEET": {
      const t = await getTrip(db, actor, docId);
      return {
        docCode: t.code, partner: null,
        doc: { code: t.code, date: formatDate(t.date), vehicle: t.vehiclePlate, driver: t.driverName, assistant: t.assistantName ?? "", route: t.routeName ?? "", note: t.note ?? "", status: t.statusLabel },
        // Mỗi điểm giao một dòng (lái xe đánh dấu kết quả + ghi tiền thu vào phiếu); hàng hóa chỉ in gọn để soát khi xếp xe.
        lines: t.stops.map((s) => ({
          stop: String(s.seq), no: String(s.seq), order: s.orderCode, customer: s.partnerName, phone: s.phone ?? "", address: s.address ?? "", orderTotal: money(s.orderTotal), due: money(s.suggestedDue),
          goods: s.lines.filter((l) => Number(l.remaining) > 0 || s.result).map((l) => `${l.productName} ${formatQty(l.remaining)} ${l.unit}`).join("; "),
        })),
        totals: { stops: String(t.stops.length) },
      };
    }
    case "GOODS_RETURN": {
      const r = await getReturn(db, actor, docId);
      const row = await db.goodsReturn.findUnique({ where: { id: docId }, select: { partnerId: true } });
      const supplier = r.kind === "SUPPLIER";
      const total = (supplier ? r.purchaseTotal : r.returnTotal) ?? "";
      const deduction = r.returnDeduction ?? "0";
      return {
        docCode: r.code, partner: await partnerOf(db, row?.partnerId ?? null),
        doc: { code: r.code, kind: supplier ? "Trả nhà cung cấp" : "Khách trả hàng", date: formatDate(r.at), orderCode: r.orderCode ?? "", note: r.note ?? "", createdBy: r.createdByName ?? "", status: r.isCancelled ? "ĐÃ HỦY" : "" },
        lines: r.lines.map((l, i) => ({ no: String(i + 1), code: l.productCode, name: l.productName, unit: l.unit, qty: formatQty(l.qty), price: money(supplier ? l.purchasePrice : l.salePrice), amount: money(supplier ? l.purchaseAmount : l.lineAmount), note: l.note ?? "", processing: "" })),
        totals: { total: money(total), deduction: Number(deduction) ? money(deduction) : "", deductionNote: r.deductionNote ?? "", net: total === "" ? "" : money(D(total).minus(deduction).toString()) },
      };
    }
    case "PRODUCTION_ORDER": {
      const p = await getProductionOrder(db as PrismaClient, actor, docId);
      const outs = (p.outputs ?? []).map((o, i) => ({ section: "Thành phẩm", no: String(i + 1), code: o.productCode, name: o.productName, spec: [o.widthMm ? `Khổ ${formatQty(o.widthMm)} mm` : "", o.stripCount > 1 ? `${o.stripCount} dải` : "", o.lengthM ? `Dài ${formatQty(o.lengthM)} m` : ""].filter(Boolean).join(" · "), unit: o.baseUnit, qty: formatQty(o.qty) }));
      const mats = p.materials.map((m, i) => ({ section: "Nguyên vật liệu tiêu hao", no: String(i + 1), code: m.productCode, name: m.productName, spec: "", unit: m.baseUnit, qty: formatQty(m.qty) }));
      return {
        docCode: p.code, partner: null,
        doc: { code: p.code, date: formatDate(p.at), note: p.note ?? "", createdBy: p.createdByName ?? "", status: p.isCancelled ? "ĐÃ HỦY" : "" },
        lines: [...outs, ...mats], totals: {},
      };
    }
    case "STOCKTAKE": {
      const s = await getStocktake(db as PrismaClient, actor, docId);
      return {
        docCode: s.code, partner: null,
        doc: { code: s.code, date: formatDate(s.at), note: s.note ?? "", createdBy: s.createdByName ?? "", statusLabel: STOCKTAKE_LABEL[s.status] ?? s.status, status: s.status === "CANCELLED" ? "ĐÃ HỦY" : "" },
        lines: s.lines.map((l) => ({ no: "", code: l.productCode, name: l.productName, unit: l.baseUnit, systemQty: l.systemQty === null ? "" : formatQty(l.systemQty), actualQty: formatQty(l.actualQty), diff: l.diff === null ? "" : formatQty(l.diff) })).map((l, i) => ({ ...l, no: String(i + 1) })),
        totals: {},
      };
    }
    case "LOSS_ADJUST": {
      const a = await getLossAdjust(db as PrismaClient, actor, docId);
      return {
        docCode: a.code, partner: null,
        doc: { code: a.code, kind: LOSS_TYPE_LABEL[a.type], date: formatDate(a.at), note: a.note ?? "", createdBy: a.createdByName ?? "", status: a.isCancelled ? "ĐÃ HỦY" : "" },
        lines: a.lines.map((l, i) => ({ no: String(i + 1), code: l.productCode, name: l.productName, unit: l.baseUnit, qty: formatQty(l.qty) })),
        totals: {},
      };
    }
    case "DISCOUNT_SETTLEMENT": {
      const s = await db.discountSettlement.findFirst({ where: { id: docId, partner: partnerScopeWhere(actor) }, include: { payment: { select: { code: true } } } });
      if (!s) throw new DomainError("Không tìm thấy phiếu tất toán.", 404);
      const creator = await db.user.findUnique({ where: { id: s.createdBy }, select: { fullName: true } });
      return {
        docCode: s.code, partner: await partnerOf(db, s.partnerId),
        doc: { code: s.code, date: formatDate(s.at), method: SETTLE_METHOD_LABEL[s.method], payment: s.payment?.code ?? "", note: s.note ?? "", createdBy: creator?.fullName ?? "", status: s.isCancelled ? "ĐÃ HỦY" : "" },
        lines: [], totals: { amount: money(s.amount.toString()) },
      };
    }
    case "SUPPLIER_ORDER": {
      const o = await db.supplierOrder.findFirst({ where: { id: docId, partner: partnerScopeWhere(actor) }, include: orderInclude });
      if (!o) throw new DomainError("Không tìm thấy đơn đặt hàng.", 404);
      const types = new Map((await db.processingType.findMany({ where: { id: { in: o.lines.flatMap((l) => (l.processingTypeId ? [l.processingTypeId] : [])) } }, select: { id: true, name: true } })).map((t) => [t.id, t.name]));
      const cancelled = progress(o) === "CANCELLED";
      return {
        docCode: o.code, partner: await partnerOf(db, o.partnerId),
        doc: { code: o.code, date: formatDate(o.date), note: o.note, createdBy: o.creator.fullName, status: cancelled ? "ĐÃ HỦY" : "" },
        lines: o.lines.map((l, i) => ({ no: String(i + 1), code: l.product.code, name: l.product.name, unit: l.unit, qty: formatQty(l.qty.toString()), price: money(l.purchasePrice.toString()), amount: money(D(l.qty).times(l.purchasePrice).toString()), processing: (l.processingTypeId && types.get(l.processingTypeId)) || "", note: [l.note, l.expectedDate ? `Dự kiến nhận: ${formatDate(l.expectedDate)}` : ""].filter(Boolean).join(" · ") })),
        totals: { total: money(o.lines.reduce((s, l) => s.plus(D(l.qty).times(l.purchasePrice)), D(0)).toString()) },
      };
    }
    default:
      throw new DomainError("Loại chứng từ này chưa hỗ trợ in.", 409, "PRINT_UNSUPPORTED");
  }
}
