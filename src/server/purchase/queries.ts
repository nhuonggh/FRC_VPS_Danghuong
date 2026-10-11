import type { Prisma, PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { listTimeRange, sortToOrderBy, type ListParams } from "@/lib/query-params";
import { escapeLike, normalizeSearch } from "@/lib/search";
import { timeRangeWhere } from "@/lib/time-presets";
import { DomainError } from "@/server/http/errors";
import { unitCostOf } from "@/server/inventory";
import { getOpenPeriod } from "@/server/period/guard";

type Db = Prisma.TransactionClient | PrismaClient;
export const PURCHASE_FILTER_KEYS = ["status", "period", "supplier"] as const;

export interface PurchaseRowDTO {
  id: number;
  code: string;
  at: Date;
  periodId: number;
  partnerId: number;
  partnerCode: string;
  partnerName: string;
  lineCount: number;
  isCancelled: boolean;
  note: string | null;
  createdByName: string | null;
  purchaseTotal?: string;
  freightCost?: string;
}

export interface PurchaseLineDTO {
  id: number;
  productId: number;
  productCode: string;
  productName: string;
  baseUnit: string;
  qty: string;
  unit: string;
  factorUsed: string;
  qtyBase: string;
  rollInfo: string | null;
  processingTypeId: number | null;
  processingTypeName: string | null;
  purchasePrice?: string;
  purchaseAmount?: string;
  allocatedFreight?: string;
  unitCost?: string;
}

export interface PurchaseDetailDTO extends Omit<PurchaseRowDTO, "lineCount"> {
  cancelReason: string | null;
  cancelledAt: Date | null;
  lines: PurchaseLineDTO[];
}

function searchWhere(query: string | undefined): Prisma.PurchaseWhereInput {
  const terms = normalizeSearch(query ?? "").split(" ").filter(Boolean);
  if (!terms.length) return {};
  return {
    AND: terms.map((term) => ({
      OR: [
        { code: { contains: escapeLike(term.toUpperCase()) } },
        { partner: { searchText: { contains: escapeLike(term) } } },
      ],
    })),
  };
}

async function periodWhere(db: Db, params: ListParams): Promise<Prisma.PurchaseWhereInput> {
  const raw = params.filters.period?.[0];
  if (raw === "all") return {};
  const value = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return { periodId: Number.isSafeInteger(value) && value > 0 ? value : (await getOpenPeriod(db)).id };
}

export async function purchaseWhere(db: Db, params: ListParams, options: { ignoreStatus?: boolean } = {}): Promise<Prisma.PurchaseWhereInput> {
  const clauses: Prisma.PurchaseWhereInput[] = [await periodWhere(db, params), searchWhere(params.q)];
  const range = listTimeRange(params);
  if (range) clauses.push({ at: timeRangeWhere(range) });
  const suppliers = (params.filters.supplier ?? []).map(Number).filter((value) => Number.isInteger(value) && value > 0);
  if (suppliers.length) clauses.push({ partnerId: { in: suppliers } });
  const status = params.filters.status?.[0];
  if (!options.ignoreStatus && (status === "active" || status === "cancelled")) clauses.push({ isCancelled: status === "cancelled" });
  return { AND: clauses };
}

const userNames = async (db: Db, ids: number[]) => new Map(
  (await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } }))
    .map((user) => [user.id, user.fullName]),
);

export async function listPurchases(db: Db, actor: Actor, params: ListParams) {
  const canSeePrice = actor.perms.has("purchase_price.view");
  const sortable = ["code", "at", ...(canSeePrice ? ["purchaseTotal"] : [])];
  const where = await purchaseWhere(db, params);
  const base = await purchaseWhere(db, params, { ignoreStatus: true });
  const [rows, total, all, cancelled] = await Promise.all([
    db.purchase.findMany({
      where,
      orderBy: [sortToOrderBy(params.sort, sortable, { at: "desc" }), { id: "desc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: { partner: { select: { code: true, name: true } }, _count: { select: { lines: true } } },
    }),
    db.purchase.count({ where }),
    db.purchase.count({ where: base }),
    db.purchase.count({ where: { AND: [base, { isCancelled: true }] } }),
  ]);
  const names = await userNames(db, rows.map((row) => row.createdBy));
  const dto: PurchaseRowDTO[] = rows.map((purchase) => ({
    id: purchase.id, code: purchase.code, at: purchase.at, periodId: purchase.periodId,
    partnerId: purchase.partnerId, partnerCode: purchase.partner.code, partnerName: purchase.partner.name,
    lineCount: purchase._count.lines, isCancelled: purchase.isCancelled, note: purchase.note,
    createdByName: names.get(purchase.createdBy) ?? null,
    purchaseTotal: purchase.purchaseTotal.toString(), freightCost: purchase.freightCost.toString(),
  }));
  return { rows: redactDeep(dto, actor.perms), total, stats: { all, active: all - cancelled, cancelled } };
}

export async function getPurchase(db: Db, actor: Actor, id: number): Promise<PurchaseDetailDTO> {
  const purchase = await db.purchase.findUnique({
    where: { id },
    include: {
      partner: { select: { code: true, name: true } },
      lines: { orderBy: { id: "asc" }, include: { product: { select: { code: true, name: true, baseUnit: true } }, processingType: { select: { name: true } } } },
    },
  });
  if (!purchase) throw new DomainError("Không tìm thấy phiếu nhập.", 404);
  const names = await userNames(db, [purchase.createdBy]);
  const dto: PurchaseDetailDTO = {
    id: purchase.id, code: purchase.code, at: purchase.at, periodId: purchase.periodId,
    partnerId: purchase.partnerId, partnerCode: purchase.partner.code, partnerName: purchase.partner.name,
    isCancelled: purchase.isCancelled, note: purchase.note, createdByName: names.get(purchase.createdBy) ?? null,
    cancelReason: purchase.cancelReason, cancelledAt: purchase.cancelledAt,
    purchaseTotal: purchase.purchaseTotal.toString(), freightCost: purchase.freightCost.toString(),
    lines: purchase.lines.map((line) => ({
      id: line.id, productId: line.productId, productCode: line.product.code, productName: line.product.name,
      baseUnit: line.product.baseUnit, qty: line.qty.toString(), unit: line.unit,
      factorUsed: line.factorUsed.toString(), qtyBase: line.qtyBase.toString(), rollInfo: line.rollInfo, processingTypeId: line.processingTypeId, processingTypeName: line.processingType?.name ?? null,
      purchasePrice: line.purchasePrice.toString(), purchaseAmount: line.purchaseAmount.toString(),
      allocatedFreight: line.allocatedFreight.toString(),
      unitCost: unitCostOf(line.purchaseAmount.plus(line.allocatedFreight), line.qtyBase).toString(),
    })),
  };
  return redactDeep(dto, actor.perms);
}
