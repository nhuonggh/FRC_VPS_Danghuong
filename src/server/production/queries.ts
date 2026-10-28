import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { listTimeRange, sortToOrderBy, type ListParams } from "@/lib/query-params";
import { DomainError } from "@/server/http/errors";
import { getOpenPeriod } from "@/server/period/guard";

export interface ProductionOutputDTO { id: number; productId: number; productCode: string; productName: string; qty: string; baseUnit: string; widthMm: string | null; stripCount: number; lengthM: string | null; allocationWeight: string; unitCost?: string | null; totalCost?: string | null }
export interface ProductionRowDTO { outputs?: ProductionOutputDTO[]; id: number; code: string; at: Date; productCode: string; productName: string; qty: string; baseUnit: string; materialCount: number; isCancelled: boolean; createdByName: string | null }
export interface ProductionDetailDTO extends Omit<ProductionRowDTO, "materialCount"> {
  allocationBasis?: string; inputWidthMm?: string | null; inputLengthM?: string | null;
  note: string | null; cancelReason: string | null;
  /** Giá thành/đv thành phẩm + tổng — chỉ khi có cost.view */
  unitCost?: string | null; totalCost?: string | null;
  materials: { id: number; productCode: string; productName: string; baseUnit: string; qty: string; unitCost?: string | null }[];
}

const outputInclude = { orderBy: { id: "asc" as const }, include: { product: { select: { code: true, name: true, baseUnit: true } } } };
const outputDTO = (o: { id: number; productId: number; qty: Prisma.Decimal; widthMm: Prisma.Decimal | null; stripCount: number; lengthM: Prisma.Decimal | null; allocationWeight: Prisma.Decimal; product: { code: string; name: string; baseUnit: string } }): ProductionOutputDTO => ({ id: o.id, productId: o.productId, productCode: o.product.code, productName: o.product.name, baseUnit: o.product.baseUnit, qty: o.qty.toString(), widthMm: o.widthMm?.toString() ?? null, stripCount: o.stripCount, lengthM: o.lengthM?.toString() ?? null, allocationWeight: o.allocationWeight.toString() });
const userNames = async (db: PrismaClient, ids: number[]) => new Map((await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));

export async function listProductionOrders(db: PrismaClient, actor: Actor, params: ListParams) {
  assertCan(actor.perms, "production.manage");
  const period = await getOpenPeriod(db), status = params.filters.status?.[0];
  const q = params.q?.trim();
  const range = listTimeRange(params);
  const productIds = (params.filters.product ?? []).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
  const base = { periodId: period.id, ...(range ? { at: { gte: range.start, lt: range.end } } : {}), ...(productIds.length ? { outputs: { some: { productId: { in: productIds } } } } : {}), ...(q ? { OR: [{ code: { contains: q, mode: "insensitive" as const } }, { outputs: { some: { product: { OR: [{ code: { contains: q, mode: "insensitive" as const } }, { name: { contains: q, mode: "insensitive" as const } }] } } } }] } : {}) };
  const where = { ...base, ...(status === "active" ? { isCancelled: false } : status === "cancelled" ? { isCancelled: true } : {}) };
  const [rows, total, all, cancelled] = await Promise.all([
    db.productionOrder.findMany({ where, include: { outputs: outputInclude, product: { select: { code: true, name: true, baseUnit: true } }, _count: { select: { materials: true } }, }, orderBy: [sortToOrderBy(params.sort, ["code", "at"], { at: "desc" }), { id: "desc" }], skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
    db.productionOrder.count({ where }), db.productionOrder.count({ where: base }), db.productionOrder.count({ where: { ...base, isCancelled: true } }),
  ]);
  const names = await userNames(db, rows.map((r) => r.createdBy));
  return {
    rows: rows.map((r): ProductionRowDTO => ({ outputs: r.outputs.map(outputDTO), id: r.id, code: r.code, at: r.at, productCode: r.product.code, productName: r.product.name, qty: r.qty.toString(), baseUnit: r.product.baseUnit, materialCount: r._count.materials, isCancelled: r.isCancelled, createdByName: names.get(r.createdBy) ?? null })),
    total, stats: { all, active: all - cancelled, cancelled },
  };
}

/** Sản phẩm đầu ra đã có lệnh trong kỳ hiện tại — nguồn cho bộ lọc "Sản phẩm" của danh sách lệnh. */
export async function productionProductOptions(db: PrismaClient): Promise<{ value: string; label: string }[]> {
  const period = await getOpenPeriod(db);
  const rows = await db.productionOutput.findMany({ where: { order: { periodId: period.id } }, distinct: ["productId"], select: { product: { select: { id: true, code: true, name: true } } } });
  return rows.map((r) => ({ value: String(r.product.id), label: `${r.product.code} — ${r.product.name}` })).sort((a, b) => a.label.localeCompare(b.label, "vi"));
}

export async function getProductionOrder(db: PrismaClient, actor: Actor, id: number): Promise<ProductionDetailDTO> {
  assertCan(actor.perms, "production.manage");
  const row = await db.productionOrder.findUnique({ where: { id }, include: { outputs: outputInclude, product: { select: { code: true, name: true, baseUnit: true } }, materials: { orderBy: { id: "asc" }, include: { materialProduct: { select: { code: true, name: true, baseUnit: true } } } } } });
  if (!row) throw new DomainError("Không tìm thấy lệnh sản xuất.", 404);
  const names = await userNames(db, [row.createdBy]);
  const dto: ProductionDetailDTO = {
    outputs: row.outputs.map(outputDTO), allocationBasis: row.allocationBasis, inputWidthMm: row.materials[0]?.widthMm?.toString() ?? null, inputLengthM: row.materials[0]?.qty.toString() ?? null,
    id: row.id, code: row.code, at: row.at, productCode: row.product.code, productName: row.product.name, qty: row.qty.toString(), baseUnit: row.product.baseUnit,
    isCancelled: row.isCancelled, createdByName: names.get(row.createdBy) ?? null, note: row.note, cancelReason: row.cancelReason,
    materials: row.materials.map((m) => ({ id: m.id, productCode: m.materialProduct.code, productName: m.materialProduct.name, baseUnit: m.materialProduct.baseUnit, qty: m.qty.toString() })),
  };
  if (actor.perms.has("cost.view") && !row.isCancelled) {
    const layers = await db.costLayer.findMany({ where: { sourceDocType: "PRODUCTION_OUT", sourceDocId: id }, select: { productId: true, qtyIn: true, unitCost: true } });
    const layer = layers.find(l => l.productId === row.productId);
    dto.outputs = dto.outputs?.map(o => { const l = layers.find(l => l.productId === o.productId); return { ...o, unitCost: l?.unitCost.toString() ?? null, totalCost: l ? l.unitCost.times(l.qtyIn).toDecimalPlaces(2).toString() : null }; });
    const consumed = await db.costConsumption.findMany({ where: { ledger: { docType: "PRODUCTION_USE", docId: id } }, select: { ledger: { select: { productId: true } }, qty: true, unitCost: true } });
    const perMaterial = new Map<number, number>();
    for (const c of consumed) perMaterial.set(c.ledger.productId, (perMaterial.get(c.ledger.productId) ?? 0) + Number(c.qty) * Number(c.unitCost));
    const ids = new Map(row.materials.map((m) => [m.id, m.materialProductId]));
    dto.unitCost = layer?.unitCost.toString() ?? null;
    dto.totalCost = layers.reduce((sum, l) => sum.plus(l.unitCost.times(l.qtyIn)), new Prisma.Decimal(0)).toDecimalPlaces(2).toString();
    dto.materials = dto.materials.map((m) => { const total = perMaterial.get(ids.get(m.id)!); return { ...m, unitCost: total === undefined ? null : String(Math.round(total)) }; });
  }
  return dto;
}
