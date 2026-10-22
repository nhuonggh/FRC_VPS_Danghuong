import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { DomainError } from "@/server/http/errors";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ymd = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/** Khoản mục của màn Đối chiếu công nợ (73): khóa dùng trong URL chi tiết. */
export const DEBT_ITEMS = {
  receipt: { label: "Phiếu thu (ghi có, không tính tiền lái xe/chuyến)", types: ["RECEIPT"], hasSource: true },
  payment: { label: "Phiếu chi trả NCC / hoàn khách (ghi nợ)", types: ["PAYMENT"], hasSource: true },
  purchase: { label: "Phiếu nhập (ghi có NCC)", types: ["PURCHASE"], hasSource: true },
  return: { label: "Trả hàng (ghi có)", types: ["RETURN"], hasSource: true },
  "debt-adj": { label: "Điều chỉnh công nợ (ròng)", types: ["DEBT_ADJ"], hasSource: true },
  delivery: { label: "Phiếu giao (ghi nợ khách)", types: ["DELIVERY"], hasSource: false },
  "trip-collect": { label: "Tiền lái xe thu (ghi có)", types: ["TRIP_COLLECT"], hasSource: false },
  "trip-discount": { label: "Tiền bớt khi giao chuyến (ghi có)", types: ["TRIP_DISCOUNT"], hasSource: false },
  "discount-settle": { label: "Tất toán chiết khấu trừ nợ (ghi có)", types: ["DISCOUNT_SETTLE"], hasSource: false },
} as const;
export type DebtItemKey = keyof typeof DEBT_ITEMS;
export const isDebtItemKey = (k: string): k is DebtItemKey => Object.prototype.hasOwnProperty.call(DEBT_ITEMS, k);

export type DebtDocStatus = "OK" | "DIFF" | "MISSING_LEDGER" | "ORPHAN" | "OUT_OF_SCOPE" | "NO_SOURCE";
export interface DebtDetailRow {
  key: string; code: string; href: string | null; date: string; partner: string;
  ledger: string; source: string | null; diff: string | null; status: DebtDocStatus; note: string;
}
export interface DebtItemDetail {
  key: DebtItemKey; label: string; hasSource: boolean;
  ledger: string; source: string | null; diff: string | null;
  rows: DebtDetailRow[];
}

interface Doc { id: number; code: string; href: string | null; at: Date; partnerId: number | null; partnerName?: string; amount: Prisma.Decimal | null; cancelled: boolean; inScope: boolean }

/** Nạp chứng từ nguồn: các chứng từ có dòng sổ (kể cả đã hủy) + các chứng từ hợp lệ đáng lẽ phải có dòng sổ. */
async function loadDocs(db: Db, key: DebtItemKey, ledgerDocIds: number[]): Promise<Doc[]> {
  const ids = { id: { in: ledgerDocIds } };
  switch (key) {
    case "receipt": {
      const rs = await db.receipt.findMany({ where: { OR: [ids, { isCancelled: false, partnerId: { not: null }, tripId: null }] }, select: { id: true, code: true, at: true, partnerId: true, amount: true, isCancelled: true, tripId: true, partner: { select: { name: true } } } });
      return rs.map((r) => ({ id: r.id, code: r.code, href: `/accounting/receipts/${r.id}`, at: r.at, partnerId: r.partnerId, partnerName: r.partner?.name, amount: r.amount, cancelled: r.isCancelled, inScope: r.partnerId !== null && r.tripId === null }));
    }
    case "payment": {
      const ps = await db.payment.findMany({ where: { OR: [ids, { isCancelled: false, kind: { in: ["TRA_NCC", "HOAN_KHACH"] } }] }, select: { id: true, code: true, at: true, partnerId: true, amount: true, isCancelled: true, kind: true, partner: { select: { name: true } } } });
      return ps.map((p) => ({ id: p.id, code: p.code, href: `/accounting/payments/${p.id}`, at: p.at, partnerId: p.partnerId, partnerName: p.partner?.name, amount: p.amount, cancelled: p.isCancelled, inScope: p.kind === "TRA_NCC" || p.kind === "HOAN_KHACH" }));
    }
    case "purchase": {
      const ps = await db.purchase.findMany({ where: { OR: [ids, { isCancelled: false }] }, select: { id: true, code: true, at: true, partnerId: true, purchaseTotal: true, isCancelled: true, partner: { select: { name: true } } } });
      return ps.map((p) => ({ id: p.id, code: p.code, href: `/purchase/orders/${p.id}`, at: p.at, partnerId: p.partnerId, partnerName: p.partner.name, amount: p.purchaseTotal, cancelled: p.isCancelled, inScope: true }));
    }
    case "return": {
      const rs = await db.goodsReturn.findMany({ where: { OR: [ids, { isCancelled: false }] }, select: { id: true, code: true, at: true, partnerId: true, totalAmount: true, isCancelled: true, partner: { select: { name: true } } } });
      return rs.map((r) => ({ id: r.id, code: r.code, href: `/returns/${r.id}`, at: r.at, partnerId: r.partnerId, partnerName: r.partner.name, amount: r.totalAmount, cancelled: r.isCancelled, inScope: true }));
    }
    case "debt-adj": {
      const as = await db.debtAdjustment.findMany({ where: { OR: [ids, { isCancelled: false }] }, select: { id: true, code: true, at: true, partnerId: true, amount: true, isCancelled: true, partner: { select: { name: true } } } });
      return as.map((a) => ({ id: a.id, code: a.code, href: "/accounting/debt-adjustments", at: a.at, partnerId: a.partnerId, partnerName: a.partner.name, amount: a.amount, cancelled: a.isCancelled, inScope: true }));
    }
    case "delivery": {
      const ns = await db.deliveryNote.findMany({ where: ids, select: { id: true, code: true, at: true, orderId: true, isCancelled: true, order: { select: { partnerId: true, partner: { select: { name: true } } } } } });
      return ns.map((n) => ({ id: n.id, code: n.code, href: `/sales/orders/${n.orderId}?tab=delivery`, at: n.at, partnerId: n.order.partnerId, partnerName: n.order.partner.name, amount: null, cancelled: n.isCancelled, inScope: true }));
    }
    case "trip-collect":
    case "trip-discount": {
      const ts = await db.tripOrder.findMany({ where: ids, select: { id: true, tripId: true, trip: { select: { code: true, tripDate: true, status: true } }, order: { select: { partnerId: true, partner: { select: { name: true } } } } } });
      return ts.map((t) => ({ id: t.id, code: t.trip.code, href: `/delivery/trips/${t.tripId}`, at: t.trip.tripDate, partnerId: t.order.partnerId, partnerName: t.order.partner.name, amount: null, cancelled: t.trip.status === "CANCELLED", inScope: true }));
    }
    case "discount-settle": {
      const ss = await db.discountSettlement.findMany({ where: ids, select: { id: true, code: true, at: true, partnerId: true, isCancelled: true, partner: { select: { name: true } } } });
      return ss.map((s) => ({ id: s.id, code: s.code, href: `/accounting/discounts/${s.partnerId}`, at: s.at, partnerId: s.partnerId, partnerName: s.partner.name, amount: null, cancelled: s.isCancelled, inScope: true }));
    }
  }
}

/** Chi tiết một khoản mục đối chiếu: từng chứng từ — số trong sổ công nợ so với số trên chứng từ gốc. */
export async function getDebtItemDetail(db: Db, actor: Actor, key: DebtItemKey): Promise<DebtItemDetail> {
  assertCan(actor.perms, "report.view");
  const def = DEBT_ITEMS[key];
  const ledger = await db.partnerLedger.findMany({ where: { docType: { in: [...def.types] } }, select: { docId: true, partnerId: true, debit: true, credit: true } });
  const amountOf = (l: { debit: Prisma.Decimal; credit: Prisma.Decimal }) => {
    switch (key) {
      case "payment": case "delivery": return l.debit;
      case "return": return l.credit.plus(l.debit);
      case "debt-adj": return l.debit.minus(l.credit);
      default: return l.credit;
    }
  };
  const byDoc = new Map<number, { amount: Prisma.Decimal; partnerId: number }>();
  for (const l of ledger) { const v = byDoc.get(l.docId); if (v) v.amount = v.amount.plus(amountOf(l)); else byDoc.set(l.docId, { amount: amountOf(l), partnerId: l.partnerId }); }

  const docs = await loadDocs(db, key, [...byDoc.keys()]);
  const partnerIds = [...new Set([...byDoc.values()].map((v) => v.partnerId))];
  const partners = new Map((await db.partner.findMany({ where: { id: { in: partnerIds } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const docById = new Map(docs.map((d) => [d.id, d]));

  const rows: DebtDetailRow[] = [];
  for (const d of docs) {
    const led = byDoc.get(d.id)?.amount ?? null;
    const valid = !d.cancelled && d.inScope;
    const src = def.hasSource ? (valid && d.amount ? d.amount : D(0)) : null;
    const ledAmt = led ?? D(0);
    const diff = src === null ? null : ledAmt.minus(src);
    let status: DebtDocStatus; let note = "";
    if (d.cancelled && led) { status = "ORPHAN"; note = "Chứng từ đã hủy nhưng vẫn còn dòng trong sổ công nợ"; }
    else if (!def.hasSource) { if (!led) continue; status = "NO_SOURCE"; }
    else if (!d.inScope && led) { status = "OUT_OF_SCOPE"; note = "Chứng từ không thuộc phạm vi đối chiếu nhưng có dòng sổ"; }
    else if (!led && valid) { status = "MISSING_LEDGER"; note = "Chứng từ hợp lệ nhưng chưa có dòng trong sổ công nợ"; }
    else if (!led) continue;
    else status = diff && !diff.isZero() ? "DIFF" : "OK";
    rows.push({ key: `${d.id}`, code: d.code, href: d.href, date: ymd(d.at), partner: d.partnerName ?? partners.get(byDoc.get(d.id)?.partnerId ?? -1) ?? "", ledger: ledAmt.toString(), source: src === null ? null : src.toString(), diff: diff === null ? null : diff.toString(), status, note });
  }
  // dòng sổ trỏ tới chứng từ không còn tồn tại
  for (const [docId, v] of byDoc) {
    if (docById.has(docId)) continue;
    rows.push({ key: `x${docId}`, code: `#${docId}`, href: null, date: "", partner: partners.get(v.partnerId) ?? "", ledger: v.amount.toString(), source: def.hasSource ? "0" : null, diff: def.hasSource ? v.amount.toString() : null, status: "ORPHAN", note: "Chứng từ không còn tồn tại" });
  }
  const bad = (r: DebtDetailRow) => (r.status === "OK" || r.status === "NO_SOURCE" ? 1 : 0);
  rows.sort((a, b) => bad(a) - bad(b) || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const ledTotal = rows.reduce((s, r) => s.plus(r.ledger), D(0));
  const srcTotal = def.hasSource ? rows.reduce((s, r) => s.plus(r.source ?? 0), D(0)) : null;
  return { key, label: def.label, hasSource: def.hasSource, ledger: ledTotal.toString(), source: srcTotal === null ? null : srcTotal.toString(), diff: srcTotal === null ? null : ledTotal.minus(srcTotal).toString(), rows };
}

export function assertDebtItem(key: string): DebtItemKey {
  if (!isDebtItemKey(key)) throw new DomainError("Không tìm thấy khoản mục đối chiếu.", 404);
  return key;
}
