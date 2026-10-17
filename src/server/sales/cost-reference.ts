import { Prisma, type PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { canViewOrderAnalysis } from "@/lib/permissions/order-analysis";
import { BomNotFoundError, resolveBom } from "@/server/bom";

export interface CostSource {
  kind: "PURCHASE" | "PRODUCTION" | "BOM";
  perBase: string | null;
  at: string;
  code: string;
  href?: string;
}
export interface CostReference {
  primary: CostSource | null;
  alternatives: CostSource[];
  message?: string;
  materials?: { code: string; name: string; unit: string; qty: string; price: string | null; amount: string | null; at: string | null }[];
}
export type IssueMode = "LEGACY" | "STOCK" | "BOM";

/** Read-only: estimates never post inventory, replace FIFO, or set selling prices. */
export async function costReference(db: PrismaClient, actor: Actor, productId: number, processingTypeId: number | null, at: Date, mode: IssueMode = "LEGACY"): Promise<CostReference | undefined> {
  if (!canViewOrderAnalysis(actor.perms)) return undefined;
  const purchaseAllowed = actor.perms.has("purchase_price.view"), costAllowed = actor.perms.has("cost.view");
  if (!purchaseAllowed && !costAllowed) return undefined;
  const useBom = !!processingTypeId && mode !== "STOCK" && (mode === "BOM" || await db.bom.count({ where: { productId, processingTypeId, versions: { some: { status: "ACTIVE" } } } }) > 0);
  if (useBom) {
    // Do not substitute the raw product's purchase price when the selected operation consumes a BOM.
    if (!costAllowed || !purchaseAllowed) return { primary: null, alternatives: [], message: "Cần quyền xem giá vốn và giá nhập để xem giá theo định mức." };
    let bom;
    try { bom = await resolveBom(db, productId, processingTypeId!, at); }
    catch (e) { if (e instanceof BomNotFoundError) return { primary: null, alternatives: [], message: "Chưa có định mức hiệu lực cho ngày đơn này." }; throw e; }
    const ids = bom.lines.map(l => l.materialProductId);
    const [products, layers] = await Promise.all([
      db.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, baseUnit: true } }),
      Promise.all(ids.map(id => db.costLayer.findFirst({ where: { productId: id, sourceDocType: "PURCHASE", at: { lte: at } }, orderBy: [{ at: "desc" }, { ledger: { seq: "desc" } }], select: { productId: true, unitCost: true, at: true } }))),
    ]);
    const materials = bom.lines.map(l => {
      const p = products.find(p => p.id === l.materialProductId)!, price = layers.find(p => p?.productId === l.materialProductId);
      return { code: p.code, name: p.name, unit: p.baseUnit, qty: l.qtyPerUnit, price: price?.unitCost.toString() ?? null, amount: price ? price.unitCost.times(l.qtyPerUnit).toString() : null, at: price?.at.toISOString() ?? null };
    });
    const complete = materials.length > 0 && materials.every(m => m.price !== null);
    const total = complete ? materials.reduce((s, m) => s.plus(m.amount!), new Prisma.Decimal(0)).toDecimalPlaces(4).toString() : null;
    return { primary: { kind: "BOM", perBase: total, at: bom.validFrom, code: `Định mức v${bom.versionNo}`, ...(actor.perms.has("bom.manage") ? { href: `/production/bom/${bom.bomId}` } : {}) }, alternatives: [], materials,
      message: complete ? "Ước tính nguyên vật liệu; chưa gồm nhân công và chi phí khác." : `Chưa đủ giá nguyên liệu: ${materials.filter(m => m.price === null).map(m => m.name).join(", ") || "định mức chưa có nguyên liệu"}.` };
  }
  const sources: CostSource[] = [];
  // ASSUMPTION: stock shows the newest authorized source; the other source stays in collapsed details.
  const types = [...(purchaseAllowed ? ["PURCHASE" as const] : []), ...(costAllowed ? ["PRODUCTION_OUT" as const] : [])];
  const found = await Promise.all(types.map(sourceDocType => db.costLayer.findFirst({ where: { productId, sourceDocType, at: { lte: at } }, orderBy: [{ at: "desc" }, { ledger: { seq: "desc" } }], select: { sourceDocType: true, sourceDocId: true, unitCost: true, at: true, ledger: { select: { seq: true } } } })));
  const layers = found.filter(l => l !== null).sort((a, b) => b.at.getTime() - a.at.getTime() || Number(b.ledger.seq - a.ledger.seq));
  for (const l of layers) {
    if (l.sourceDocType === "PURCHASE") {
      const p = await db.purchase.findUnique({ where: { id: l.sourceDocId }, select: { code: true, isCancelled: true } });
      if (!p?.isCancelled) sources.push({ kind: "PURCHASE", perBase: l.unitCost.toString(), at: l.at.toISOString(), code: p?.code ?? "Phiếu nhập", ...(p && actor.perms.has("purchase.view") ? { href: `/purchase/orders/${l.sourceDocId}` } : {}) });
    } else {
      const p = await db.productionOrder.findUnique({ where: { id: l.sourceDocId }, select: { code: true, isCancelled: true } });
      if (p && !p.isCancelled) sources.push({ kind: "PRODUCTION", perBase: l.unitCost.toString(), at: l.at.toISOString(), code: p.code, ...(actor.perms.has("production.manage") ? { href: `/production/orders/${l.sourceDocId}` } : {}) });
    }
  }
  return { primary: sources[0] ?? null, alternatives: sources.slice(1), ...(sources.length ? {} : { message: "Chưa có giá nhập hoặc giá thành sản xuất phù hợp." }) };
}
