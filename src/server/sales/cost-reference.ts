import { Prisma, type PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { canViewOrderAnalysis } from "@/lib/permissions/order-analysis";
import { BomNotFoundError, resolveBom } from "@/server/bom";
import { effectiveReferenceCostPlans, isMeter } from "@/server/processing/reference-cost-plans";
import { dateOnly } from "@/server/bom/resolve";
import { ictYmd } from "@/lib/time";
import { formatCurrency, formatDate } from "@/lib/format";

export interface CostSource {
  kind: "PURCHASE" | "PRODUCTION" | "BOM";
  perBase: string | null;
  at: string;
  code: string;
  href?: string;
}
export interface CostReference {
  stockWarning?: string;
  components?: { label: string; perBase: string | null; source: string }[];
  planId?: number;
  feePlanId?: number;
  areaRatio?: string;
  primary: CostSource | null;
  alternatives: CostSource[];
  message?: string;
  materials?: { code: string; name: string; unit: string; qty: string; price: string | null; amount: string | null; at: string | null }[];
}
export type IssueMode = "LEGACY" | "STOCK" | "BOM";

/** Read-only: estimates never post inventory, replace FIFO, or set selling prices. */
export async function costReference(db: PrismaClient | Prisma.TransactionClient, actor: Actor, productId: number, processingTypeId: number | null, at: Date, mode: IssueMode = "LEGACY"): Promise<CostReference | undefined> {
  if (!canViewOrderAnalysis(actor.perms)) return undefined;
  const purchaseAllowed = actor.perms.has("purchase_price.view"), costAllowed = actor.perms.has("cost.view");
  if (!purchaseAllowed && !costAllowed) return undefined;
  let useBom = !!processingTypeId && mode !== "STOCK" && (mode === "BOM" || await db.bom.count({ where: { productId, processingTypeId, versions: { some: { status: "ACTIVE" } } } }) > 0);
  if (!useBom && processingTypeId && mode !== "STOCK") {
    useBom = await db.referenceCostPlan.count({ where: { processingTypeId, OR: [{ productId }, { productId: null }], validFrom: { lte: dateOnly(ictYmd(at)) } } }) > 0;
  }
  if (useBom) {
    // Do not substitute the raw product's purchase price when the selected operation consumes a BOM.
    if (!costAllowed || !purchaseAllowed) return { primary: null, alternatives: [], message: "Cần quyền xem giá vốn và giá nhập để xem giá theo định mức." };
    let bom: Awaited<ReturnType<typeof resolveBom>> | null = null;
    try { bom = await resolveBom(db, productId, processingTypeId!, at); }
    catch (e) { if (!(e instanceof BomNotFoundError)) throw e; }
    const { plan, defaults } = await effectiveReferenceCostPlans(db, productId, processingTypeId!, at);
    // Không có BOM: vẫn tính được nếu có mức giá vốn (tôn + phí gia công), vật liệu phụ = 0.
    if (!bom && !plan && !defaults) return { primary: null, alternatives: [], message: "Chưa có định mức hiệu lực cho ngày đơn này." };
    const bomLines = bom?.lines ?? [];
    const ids = bomLines.map(l => l.materialProductId);
    const [products, layers] = await Promise.all([
      db.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, baseUnit: true } }),
      Promise.all(ids.map(id => db.costLayer.findFirst({ where: { productId: id, sourceDocType: "PURCHASE", at: { lte: at } }, orderBy: [{ at: "desc" }, { ledger: { seq: "desc" } }], select: { productId: true, unitCost: true, at: true } }))),
    ]);
    const materials = bomLines.map(l => {
      const p = products.find(p => p.id === l.materialProductId)!, price = layers.find(p => p?.productId === l.materialProductId);
      return { code: p.code, name: p.name, unit: p.baseUnit, qty: l.qtyPerUnit, price: price?.unitCost.toString() ?? null, amount: price ? price.unitCost.times(l.qtyPerUnit).toString() : null, at: price?.at.toISOString() ?? null };
    });
    if (plan || defaults) {
      const source: CostSource = bom
        ? { kind: "BOM", perBase: null, at: bom.validFrom, code: `Định mức v${bom.versionNo}` }
        : { kind: "BOM", perBase: null, at: (plan ?? defaults)!.validFrom.toISOString().slice(0, 10), code: "Chưa có định mức" };
      if (!plan?.tonProduct) return { primary: source, alternatives: [], message: "Đã có phí gia công nhưng chưa cấu hình tôn đầu vào cho sản phẩm/kiểu này." };
      const [target, ownRatio, processing] = await Promise.all([
        db.product.findUniqueOrThrow({ where: { id: productId }, select: { baseUnit: true } }),
        db.productProcessingRatio.findUnique({ where: { productId_processingTypeId: { productId, processingTypeId: processingTypeId! } } }),
        db.processingType.findUniqueOrThrow({ where: { id: processingTypeId! }, select: { ratio: true } }),
      ]);
      const ratio = ownRatio?.ratio ?? processing.ratio;
      if (!isMeter(target.baseUnit)) return { primary: source, alternatives: [], message: "Chưa có quy đổi đơn vị sản phẩm về mét dài để tính dự toán." };
      if (plan.fixedPricePerM2 !== null && (!ratio || !ratio.gt(0))) return { primary: source, alternatives: [], message: "Chưa có tỷ lệ m²/m dài để quy đổi giá tôn theo khổ thành phẩm." };
      const tonIndex = bomLines.findIndex(l => l.materialProductId === plan.tonProductId);
      // Tôn được chọn đã có trong BOM: thay thành phần đó, tuyệt đối không cộng thêm lần hai.
      const auxiliary = materials.filter((_m, index) => index !== tonIndex);
      const quantity = tonIndex >= 0 ? new Prisma.Decimal(bomLines[tonIndex]!.qtyPerUnit) : plan.tonQtyPerMeter;
      const layer = plan.fixedPricePerM2 === null ? await db.costLayer.findFirst({
        where: { productId: plan.tonProductId!, sourceDocType: "PURCHASE", at: { lte: at } },
        orderBy: [{ at: "desc" }, { ledger: { seq: "desc" } }], select: { unitCost: true, at: true },
      }) : null;
      const tonAmount = plan.fixedPricePerM2 !== null ? plan.fixedPricePerM2.times(ratio!) : layer?.unitCost.times(quantity) ?? null;
      const auxiliaryAmount = auxiliary.every(m => m.amount !== null) ? auxiliary.reduce((s, m) => s.plus(m.amount!), new Prisma.Decimal(0)) : null;
      const fee = plan.feePerMeter ?? defaults?.feePerMeter ?? null;
      const components = [
        { label: "Tôn đầu vào", perBase: tonAmount?.toString() ?? null, source: `${plan.tonProduct.code} · ${plan.fixedPricePerM2 !== null ? `Giá kế hoạch ${formatCurrency(plan.fixedPricePerM2.toString())}/m² theo khổ thành phẩm` : layer ? `Giá nhập ${formatDate(layer.at)}` : "Chưa có giá nhập"}` },
        { label: "Vật liệu phụ theo định mức", perBase: auxiliaryAmount?.toString() ?? null, source: source.code },
        { label: "Phí gia công gộp", perBase: fee?.toString() ?? null, source: plan.feePerMeter !== null ? "Mức riêng sản phẩm · đ/m dài" : defaults ? `Mặc định kiểu · hiệu lực ${formatDate(defaults.validFrom)} · đ/m dài` : "Chưa cấu hình" },
      ];
      const total = tonAmount !== null && auxiliaryAmount !== null && fee !== null ? tonAmount.plus(auxiliaryAmount).plus(fee).toDecimalPlaces(4).toString() : null;
      return { primary: { ...source, perBase: total }, alternatives: [], components, materials: auxiliary, planId: plan.id,
        stockWarning: bom && tonIndex < 0 ? "Tôn đầu vào chưa có trong BOM xuất kho. Dự toán không tự bổ sung dòng xuất tôn; cần rà soát định mức vật tư." : undefined,
        feePlanId: plan.feePerMeter === null ? defaults?.id : undefined, areaRatio: ratio?.toString(),
        message: `${total === null ? "Chưa đủ giá tôn, vật liệu phụ hoặc phí gia công. " : "Gồm tôn, vật liệu phụ và phí gia công gộp. "}Giá kế hoạch hiệu lực ${formatDate(plan.validFrom)}.${!bom ? " Sản phẩm chưa có định mức nên không tính vật liệu phụ." : tonIndex < 0 ? " Tôn chưa có trong BOM xuất kho; dự toán không tự bổ sung dòng xuất tôn." : " Tôn trong BOM đã được tính một lần."}` };
    }
    if (!bom) return { primary: null, alternatives: [], message: "Chưa có định mức hiệu lực cho ngày đơn này." };
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
