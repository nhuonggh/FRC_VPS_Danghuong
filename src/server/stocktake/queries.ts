import type { PrismaClient, StocktakeStatus } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { sortToOrderBy, type ListParams } from "@/lib/query-params";
import { DomainError } from "@/server/http/errors";
import { getOnHand } from "@/server/inventory";
import { getOpenPeriod } from "@/server/period/guard";

import { STOCKTAKE_LABEL, type StocktakeRowDTO, type StocktakeStatusKey } from "@/components/stocktake/labels";
export { STOCKTAKE_LABEL, type StocktakeRowDTO };
export interface StocktakeDetailDTO {
  id: number; code: string; at: Date; status: StocktakeStatusKey; note: string | null; cancelReason: string | null; createdByName: string | null;
  lines: { id: number; productId: number; productCode: string; productName: string; baseUnit: string; actualQty: string; /** Nháp: tồn sổ sách hiện tại; đã chốt: tồn lúc chốt */ systemQty: string | null; diff: string | null; unitCost?: string | null }[];
}

export async function listStocktakes(db: PrismaClient, actor: Actor, params: ListParams) {
  assertCan(actor.perms, "stocktake.manage");
  const period = await getOpenPeriod(db), status = params.filters.status?.[0];
  const base = { periodId: period.id }, filter = (["DRAFT", "DONE", "CANCELLED"].includes(status ?? "") ? status : undefined) as StocktakeStatus | undefined, where = { ...base, ...(filter ? { status: filter } : {}) };
  const [rows, total, groups] = await Promise.all([
    db.stocktake.findMany({ where, include: { _count: { select: { lines: true } } }, orderBy: [sortToOrderBy(params.sort, ["code", "at"], { at: "desc" }), { id: "desc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
    db.stocktake.count({ where }), db.stocktake.groupBy({ by: ["status"], where: base, _count: true }),
  ]);
  const names = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.createdBy) } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  const count = (s: string) => groups.find((g) => g.status === s)?._count ?? 0;
  return {
    rows: rows.map((r): StocktakeRowDTO => ({ id: r.id, code: r.code, at: r.at, status: r.status, lineCount: r._count.lines, note: r.note, createdByName: names.get(r.createdBy) ?? null })),
    total, stats: { all: count("DRAFT") + count("DONE") + count("CANCELLED"), draft: count("DRAFT"), done: count("DONE"), cancelled: count("CANCELLED") },
  };
}

export async function getStocktake(db: PrismaClient, actor: Actor, id: number): Promise<StocktakeDetailDTO> {
  assertCan(actor.perms, "stocktake.manage");
  const row = await db.stocktake.findUnique({ where: { id }, include: { lines: { orderBy: { id: "asc" }, include: { product: { select: { code: true, name: true, baseUnit: true } } } } } });
  if (!row) throw new DomainError("Không tìm thấy phiếu kiểm kho.", 404);
  const creator = await db.user.findUnique({ where: { id: row.createdBy }, select: { fullName: true } });
  const showCost = actor.perms.has("cost.view");
  const lines = [];
  for (const l of row.lines) {
    const system = row.status === "DRAFT" ? await getOnHand(db, row.periodId, l.productId) : l.systemQty;
    lines.push({
      id: l.id, productId: l.productId, productCode: l.product.code, productName: l.product.name, baseUnit: l.product.baseUnit, actualQty: l.actualQty.toString(),
      systemQty: system?.toString() ?? null, diff: row.status === "DRAFT" && system ? l.actualQty.minus(system).toString() : l.diff?.toString() ?? null,
      ...(showCost ? { unitCost: l.unitCost?.toString() ?? null } : {}),
    });
  }
  return { id: row.id, code: row.code, at: row.at, status: row.status, note: row.note, cancelReason: row.cancelReason, createdByName: creator?.fullName ?? null, lines };
}
