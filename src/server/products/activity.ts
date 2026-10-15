import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";

export interface ProductPricingDTO {
  /** Giá nhập gần nhất trên đơn vị gốc — chỉ với `purchase_price.view`; null = chưa từng nhập mua */
  lastPurchase: null | { unitCost: string; at: string; docId: number; code: string | null };
  /** Giá bán gần nhất (theo đơn vị của dòng bán) — chỉ với `sale_price.view` */
  lastSale: null | { salePrice: string; unit: string; orderId: number; orderCode: string; at: string };
  canSeePurchase: boolean; canSeeSale: boolean;
}
export interface ProductMovementDTO { id: number; at: string; docType: string; label: string; href: string | null; /** Khách hàng / NCC của chứng từ (null = chứng từ không có đối tác) */ partner: string | null; qtyIn: string; qtyOut: string }

const LABEL: Record<string, string> = {
  OPENING: "Số đầu kỳ", PURCHASE: "Phiếu nhập hàng", ADJ_IN: "Nhập kho không NCC", RETURN_IN: "Khách trả hàng", PRODUCTION_OUT: "Nhập thành phẩm SX", STOCKTAKE_IN: "Kiểm kho (thừa)",
  SALE: "Bán hàng", ADJ_LOSS: "Hao hụt", WRITE_OFF: "Xuất hủy", RETURN_SUPPLIER: "Trả nhà cung cấp", PRODUCTION_USE: "Xuất NVL sản xuất", PROCESSING_USE: "Xuất NVL gia công", STOCKTAKE_OUT: "Kiểm kho (thiếu)",
};
const HREF: Record<string, (id: number) => string> = {
  PURCHASE: (id) => `/purchase/orders/${id}`, ADJ_IN: (id) => `/purchase/adjustments-in/${id}`, SALE: (id) => `/sales/orders/${id}`,
  ADJ_LOSS: (id) => `/inventory/adjustments/${id}`, WRITE_OFF: (id) => `/inventory/adjustments/${id}`,
  STOCKTAKE_IN: (id) => `/inventory/stocktakes/${id}`, STOCKTAKE_OUT: (id) => `/inventory/stocktakes/${id}`,
  PRODUCTION_OUT: (id) => `/production/orders/${id}`, PRODUCTION_USE: (id) => `/production/orders/${id}`,
};

export async function getProductPricing(db: PrismaClient, actor: Actor, productId: number): Promise<ProductPricingDTO> {
  const canSeePurchase = actor.perms.has("purchase_price.view"), canSeeSale = actor.perms.has("sale_price.view");
  let lastPurchase: ProductPricingDTO["lastPurchase"] = null, lastSale: ProductPricingDTO["lastSale"] = null;
  if (canSeePurchase) {
    const l = await db.costLayer.findFirst({ where: { productId, sourceDocType: "PURCHASE" }, orderBy: [{ at: "desc" }, { ledger: { seq: "desc" } }], select: { unitCost: true, at: true, sourceDocId: true } });
    if (l) {
      const p = await db.purchase.findUnique({ where: { id: l.sourceDocId }, select: { code: true } });
      lastPurchase = { unitCost: l.unitCost.toString(), at: l.at.toISOString(), docId: l.sourceDocId, code: p?.code ?? null };
    }
  }
  if (canSeeSale) {
    const s = await db.saleOrderLine.findFirst({ where: { productId, order: { isCancelled: false, isDraft: false } }, orderBy: [{ at: "desc" }, { id: "desc" }], select: { salePrice: true, unit: true, at: true, order: { select: { id: true, code: true } } } });
    if (s) lastSale = { salePrice: s.salePrice.toString(), unit: s.unit, orderId: s.order.id, orderCode: s.order.code, at: s.at.toISOString() };
  }
  return { lastPurchase, lastSale, canSeePurchase, canSeeSale };
}

/** 30 dòng sổ kho gần nhất của mã (mới nhất trước) — cần `stock.view`. */
export async function getProductMovements(db: PrismaClient, actor: Actor, productId: number): Promise<ProductMovementDTO[] | null> {
  if (!actor.perms.has("stock.view")) return null;
  const rows = await db.stockLedger.findMany({ where: { productId }, orderBy: [{ at: "desc" }, { seq: "desc" }], take: 30, select: { id: true, at: true, docType: true, docId: true, qtyIn: true, qtyOut: true } });
  const ids = (types: string[]) => [...new Set(rows.filter((r) => types.includes(r.docType)).map((r) => r.docId))];
  const [purchases, orders, returns] = await Promise.all([
    ids(["PURCHASE"]).length ? db.purchase.findMany({ where: { id: { in: ids(["PURCHASE"]) } }, select: { id: true, partner: { select: { name: true } } } }) : [],
    ids(["SALE", "PROCESSING_USE"]).length ? db.saleOrder.findMany({ where: { id: { in: ids(["SALE", "PROCESSING_USE"]) } }, select: { id: true, walkInName: true, partner: { select: { name: true } } } }) : [],
    ids(["RETURN_IN", "RETURN_SUPPLIER"]).length ? db.goodsReturn.findMany({ where: { id: { in: ids(["RETURN_IN", "RETURN_SUPPLIER"]) } }, select: { id: true, partner: { select: { name: true } } } }) : [],
  ]);
  const byPurchase = new Map(purchases.map((x) => [x.id, x.partner.name])), byOrder = new Map(orders.map((x) => [x.id, x.walkInName?.trim() || x.partner.name])), byReturn = new Map(returns.map((x) => [x.id, x.partner.name]));
  const partnerOf = (type: string, id: number) => (type === "PURCHASE" ? byPurchase.get(id) : type === "SALE" || type === "PROCESSING_USE" ? byOrder.get(id) : type === "RETURN_IN" || type === "RETURN_SUPPLIER" ? byReturn.get(id) : undefined) ?? null;
  return rows.map((r) => ({ id: r.id, at: r.at.toISOString(), docType: r.docType, label: LABEL[r.docType] ?? r.docType, href: HREF[r.docType]?.(r.docId) ?? null, partner: partnerOf(r.docType, r.docId), qtyIn: r.qtyIn.toString(), qtyOut: r.qtyOut.toString() }));
}
