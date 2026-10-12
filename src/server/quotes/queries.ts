import { Prisma, type PrismaClient, type QuoteStatus } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { sortToOrderBy, type ListParams } from "@/lib/query-params";
import { escapeLike, normalizeSearch } from "@/lib/search";
import { ictYmd } from "@/lib/time";
import { DomainError } from "@/server/http/errors";
import { productOptionsByIds } from "@/server/products/queries";
import type { QuoteInput } from "./schemas";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const round2 = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const amountOf = (l: { qty: Prisma.Decimal; salePrice: Prisma.Decimal }) => round2(l.qty.times(l.salePrice));

export const QUOTE_FILTER_KEYS = ["status"] as const;
const STATUSES: readonly QuoteStatus[] = ["DRAFT", "SENT", "CONVERTED", "CANCELLED"];

export interface QuoteRowDTO {
  id: number; code: string; at: Date; partnerCode: string; partnerName: string; lineCount: number; status: QuoteStatus; quoteTotal?: string;
}
export interface QuoteDetailDTO extends Omit<QuoteRowDTO, "lineCount"> {
  note: string | null; createdByName: string | null; convertedOrder: { id: number; code: string } | null;
  lines: { id: number; productCode: string; productName: string; unit: string; qty: string; note: string | null; processingTypeName: string | null; salePrice?: string; lineAmount?: string }[];
}

function where(actor: Actor, params: ListParams): Prisma.QuoteWhereInput {
  const terms = normalizeSearch(params.q ?? "").split(" ").filter(Boolean);
  const status = (params.filters.status ?? []).filter((s): s is QuoteStatus => (STATUSES as readonly string[]).includes(s));
  return {
    AND: [
      { partner: partnerScopeWhere(actor) },
      ...(status.length ? [{ status: { in: status } }] : []),
      ...terms.map((t) => ({ OR: [{ code: { contains: escapeLike(t.toUpperCase()) } }, { partner: { searchText: { contains: escapeLike(t) } } }] })),
    ],
  };
}

export async function listQuotes(db: Db, actor: Actor, params: ListParams) {
  const w = where(actor, params);
  const [rows, total] = await Promise.all([
    db.quote.findMany({
      where: w, orderBy: sortToOrderBy(params.sort, ["at", "code"], { at: "desc" }), skip: (params.page - 1) * params.pageSize, take: params.pageSize,
      include: { partner: { select: { code: true, name: true } }, lines: { select: { qty: true, salePrice: true } } },
    }),
    db.quote.count({ where: w }),
  ]);
  const out: QuoteRowDTO[] = rows.map((q) => ({
    id: q.id, code: q.code, at: q.at, partnerCode: q.partner.code, partnerName: q.partner.name, lineCount: q.lines.length, status: q.status,
    quoteTotal: q.lines.reduce((s, l) => s.plus(amountOf(l)), D(0)).toString(),
  }));
  return { rows: redactDeep(out, actor.perms), total };
}

export async function getQuote(db: Db, actor: Actor, id: number): Promise<QuoteDetailDTO> {
  const q = await db.quote.findFirst({
    where: { id, partner: partnerScopeWhere(actor) },
    include: {
      partner: { select: { code: true, name: true } }, convertedOrder: { select: { id: true, code: true } },
      lines: { orderBy: { id: "asc" }, include: { product: { select: { code: true, name: true } }, processingType: { select: { name: true } } } },
    },
  });
  if (!q) throw new DomainError("Không tìm thấy báo giá.", 404);
  const creator = await db.user.findUnique({ where: { id: q.createdBy }, select: { fullName: true } });
  const dto: QuoteDetailDTO = {
    id: q.id, code: q.code, at: q.at, partnerCode: q.partner.code, partnerName: q.partner.name, status: q.status, note: q.note,
    createdByName: creator?.fullName ?? null, convertedOrder: q.convertedOrder,
    quoteTotal: q.lines.reduce((s, l) => s.plus(amountOf(l)), D(0)).toString(),
    lines: q.lines.map((l) => ({
      id: l.id, productCode: l.product.code, productName: l.product.name, unit: l.unit, qty: l.qty.toString(), note: l.note, processingTypeName: l.processingType?.name ?? null,
      salePrice: l.salePrice.toString(), lineAmount: amountOf(l).toString(),
    })),
  };
  return redactDeep(dto, actor.perms);
}

/** Dữ liệu nạp form SỬA báo giá (đúng dạng `QuoteInput`). Chỉ gọi cho người có quyền sửa + xem giá. */
export async function getQuoteForEdit(db: Db, actor: Actor, id: number) {
  const q = await db.quote.findFirst({ where: { id, partner: partnerScopeWhere(actor) }, include: { partner: { select: { code: true, name: true } }, lines: { orderBy: { id: "asc" } } } });
  if (!q) throw new DomainError("Không tìm thấy báo giá.", 404);
  if (q.status === "CONVERTED" || q.status === "CANCELLED") throw new DomainError("Báo giá đã chốt, không sửa được.", 409);
  const defaults: QuoteInput = {
    partnerId: q.partnerId, date: ictYmd(q.at), note: q.note ?? "",
    lines: q.lines.map((l) => ({ productId: l.productId, unit: l.unit, qty: Number(l.qty), salePrice: Number(l.salePrice), note: l.note ?? "", processingTypeId: l.processingTypeId })),
  };
  return { quoteId: q.id, code: q.code, customer: { value: q.partnerId, label: `${q.partner.code} — ${q.partner.name}` }, products: await productOptionsByIds(db, q.lines.map((l) => l.productId)), defaults };
}
