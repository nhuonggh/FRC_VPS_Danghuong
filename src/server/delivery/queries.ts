import type { Prisma, PrismaClient } from "@prisma/client";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { escapeLike, normalizeSearch } from "@/lib/search";

type Db = Prisma.TransactionClient | PrismaClient;

export interface DeliveryNoteRowDTO {
  id: number; code: string; at: Date; orderId: number; orderCode: string; partnerName: string; lineCount: number; isCancelled: boolean;
}

/** Danh sách phiếu giao (mã 37). Không có tiền — chỉ số lượng/dòng; phạm vi "khách của mình" áp ở tầng query. */
export async function listDeliveryNotes(db: Db, actor: Actor, params: ListParams) {
  const terms = normalizeSearch(params.q ?? "").split(" ").filter(Boolean);
  const where: Prisma.DeliveryNoteWhereInput = {
    AND: [
      { order: { partner: partnerScopeWhere(actor) } },
      ...terms.map((t) => ({ OR: [{ code: { contains: escapeLike(t.toUpperCase()) } }, { order: { code: { contains: escapeLike(t.toUpperCase()) } } }, { order: { partner: { searchText: { contains: escapeLike(t) } } } }] })),
    ],
  };
  const [rows, total] = await Promise.all([
    db.deliveryNote.findMany({
      where, orderBy: [{ at: "desc" }, { id: "desc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize,
      include: { order: { select: { id: true, code: true, partner: { select: { name: true } } } }, _count: { select: { lines: true } } },
    }),
    db.deliveryNote.count({ where }),
  ]);
  const out: DeliveryNoteRowDTO[] = rows.map((n) => ({
    id: n.id, code: n.code, at: n.at, orderId: n.order.id, orderCode: n.order.code, partnerName: n.order.partner.name, lineCount: n._count.lines, isCancelled: n.isCancelled,
  }));
  return { rows: out, total };
}
