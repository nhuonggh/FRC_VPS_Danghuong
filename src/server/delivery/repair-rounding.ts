import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { deliveryValuesOf, rewriteDeliveryLedger } from "./service";

type Db = Prisma.TransactionClient | PrismaClient;

export interface DeliveryMismatch {
  orderId: number; orderCode: string; noteId: number; noteCode: string; periodOpen: boolean;
  current: string; expected: string;
}

/**
 * Phiếu giao có công nợ (sổ đối tác) khác giá trị đúng theo công thức hiện hành — dùng để sửa các đơn đã giao TRƯỚC khi phần chênh
 * làm tròn tổng ÂM được chia vào phiếu giao (đơn làm tròn xuống ghi công nợ theo tổng chưa làm tròn). Chỉ XEM, không ghi gì.
 */
export async function findDeliveryMismatches(db: Db, orderIds?: number[]): Promise<DeliveryMismatch[]> {
  const orders = await db.saleOrder.findMany({
    where: { isCancelled: false, roundTotal: true, ...(orderIds ? { id: { in: orderIds } } : {}) },
    include: { lines: true }, orderBy: { id: "asc" },
  });
  const out: DeliveryMismatch[] = [];
  for (const order of orders) {
    const notes = await db.deliveryNote.findMany({ where: { orderId: order.id, isCancelled: false }, orderBy: [{ at: "asc" }, { id: "asc" }], include: { lines: true, period: { select: { status: true } } } });
    if (!notes.length) continue;
    const expected = deliveryValuesOf(order, notes);
    const ledger = await db.partnerLedger.groupBy({ by: ["docId"], where: { docType: "DELIVERY", docId: { in: notes.map((n) => n.id) } }, _sum: { debit: true } });
    const current = new Map(ledger.map((r) => [r.docId, r._sum.debit]));
    for (const note of notes) {
      const want = expected.get(note.id)!, have = current.get(note.id) ?? 0;
      if (!want.equals(have)) out.push({ orderId: order.id, orderCode: order.code, noteId: note.id, noteCode: note.code, periodOpen: note.period.status === "OPEN", current: String(have), expected: want.toString() });
    }
  }
  return out;
}

/**
 * Ghi lại công nợ giao hàng của các đơn lệch. Đơn có phiếu giao thuộc kỳ ĐÃ KẾT SỔ bị bỏ qua (sổ kỳ cũ bất biến) — trả về trong `skipped`.
 * Không đụng số "phải thu" đã chốt của chuyến giao (`TripOrder.dueAmount`).
 */
export async function repairDeliveryMismatches(tx: Prisma.TransactionClient, actor: Actor, mismatches: readonly DeliveryMismatch[]): Promise<{ fixed: number[]; skipped: number[] }> {
  const byOrder = new Map<number, DeliveryMismatch[]>();
  for (const m of mismatches) byOrder.set(m.orderId, [...(byOrder.get(m.orderId) ?? []), m]);
  const fixed: number[] = [], skipped: number[] = [];
  for (const [orderId, list] of byOrder) {
    if (list.some((m) => !m.periodOpen)) { skipped.push(orderId); continue; }
    await rewriteDeliveryLedger(tx, actor, orderId);
    await writeAudit(tx, { userId: actor.userId, action: "delivery.ledger_repair", entity: "SaleOrder", entityId: orderId, before: { notes: list.map((m) => ({ note: m.noteCode, debit: m.current })) }, after: { notes: list.map((m) => ({ note: m.noteCode, debit: m.expected })) } });
    fixed.push(orderId);
  }
  return { fixed, skipped };
}
