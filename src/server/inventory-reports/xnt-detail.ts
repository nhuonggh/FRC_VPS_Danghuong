import { Prisma, type PrismaClient } from "@prisma/client";
import { redactDeep } from "@/lib/permissions/redact";
import type { Actor } from "@/lib/permissions/scope";
import { getOpenPeriod } from "@/server/period/guard";

/**
 * Một dòng chi tiết XNT = một dòng sổ kho của sản phẩm trong khoảng ngày.
 * Giá nhập/giá bán quy về ĐƠN VỊ GỐC (cùng đơn vị với số lượng); `purchasePrice`/`salePrice`/`unitCost`/`unitCostOut`
 * là khóa nhạy cảm nên `redactDeep` tự bỏ khi người xem thiếu quyền tương ứng.
 */
export interface XntDetailRow {
  id: number; at: string; docType: string; label: string; href: string | null; code: string | null; partner: string | null;
  qtyIn: string; qtyOut: string; balance: string;
  /** Giá nhập trên phiếu (PURCHASE) — `purchase_price.view` */ purchasePrice?: string;
  /** Giá vốn của lô nhập (mọi loại nhập) — `cost.view` */ unitCost?: string;
  /** Giá bán trên đơn (SALE) — `sale_price.view` */ salePrice?: string;
  /** Giá vốn FIFO của lượng xuất — `cost.view` */ unitCostOut?: string;
}
export interface XntDetail {
  product: { id: number; code: string; name: string; baseUnit: string };
  opening: string; inQty: string; outQty: string; closing: string; rows: XntDetailRow[];
}

const LABEL: Record<string, string> = {
  OPENING: "Số đầu kỳ", PURCHASE: "Phiếu nhập hàng", ADJ_IN: "Nhập kho không NCC", RETURN_IN: "Khách trả hàng", PRODUCTION_OUT: "Nhập thành phẩm SX", STOCKTAKE_IN: "Kiểm kho (thừa)",
  SALE: "Bán hàng", ADJ_LOSS: "Hao hụt", WRITE_OFF: "Xuất hủy", RETURN_SUPPLIER: "Trả nhà cung cấp", PRODUCTION_USE: "Xuất NVL sản xuất", PROCESSING_USE: "Xuất NVL gia công", STOCKTAKE_OUT: "Kiểm kho (thiếu)",
};
const HREF: Record<string, (id: number) => string> = {
  PURCHASE: (id) => `/purchase/orders/${id}`, ADJ_IN: (id) => `/purchase/adjustments-in/${id}`, SALE: (id) => `/sales/orders/${id}`, PROCESSING_USE: (id) => `/sales/orders/${id}`,
  ADJ_LOSS: (id) => `/inventory/adjustments/${id}`, WRITE_OFF: (id) => `/inventory/adjustments/${id}`,
  STOCKTAKE_IN: (id) => `/inventory/stocktakes/${id}`, STOCKTAKE_OUT: (id) => `/inventory/stocktakes/${id}`,
  PRODUCTION_OUT: (id) => `/production/orders/${id}`, PRODUCTION_USE: (id) => `/production/orders/${id}`,
};

/** Chi tiết xuất nhập tồn của 1 sản phẩm trong [from, to): tồn đầu + từng dòng sổ kho (kèm đối tác, giá nhập/bán/vốn) + số dư chạy. */
export async function xntDetail(db: PrismaClient, actor: Actor, productId: number, from: Date, to: Date): Promise<XntDetail | null> {
  const product = await db.product.findUnique({ where: { id: productId }, select: { id: true, code: true, name: true, baseUnit: true } });
  if (!product) return null;
  const period = await getOpenPeriod(db);
  const [before, ledger] = await Promise.all([
    db.stockLedger.aggregate({ where: { periodId: period.id, productId, at: { lt: from } }, _sum: { qtyIn: true, qtyOut: true } }),
    db.stockLedger.findMany({ where: { periodId: period.id, productId, at: { gte: from, lt: to } }, orderBy: [{ at: "asc" }, { seq: "asc" }], select: { id: true, at: true, docType: true, docId: true, docLineId: true, qtyIn: true, qtyOut: true, unitCostOut: true, layer: { select: { unitCost: true } } } }),
  ]);
  const idsOf = (types: string[], key: "docId" | "docLineId") => [...new Set(ledger.filter((r) => types.includes(r.docType)).map((r) => r[key]))];
  const purchaseIds = idsOf(["PURCHASE"], "docId"), purchaseLineIds = idsOf(["PURCHASE"], "docLineId");
  const orderIds = idsOf(["SALE", "PROCESSING_USE"], "docId"), saleLineIds = idsOf(["SALE"], "docLineId");
  const returnIds = idsOf(["RETURN_IN", "RETURN_SUPPLIER"], "docId");
  const [purchases, purchaseLines, orders, saleLines, returns] = await Promise.all([
    purchaseIds.length ? db.purchase.findMany({ where: { id: { in: purchaseIds } }, select: { id: true, code: true, partner: { select: { name: true } } } }) : [],
    purchaseLineIds.length ? db.purchaseLine.findMany({ where: { id: { in: purchaseLineIds } }, select: { id: true, purchasePrice: true, factorUsed: true } }) : [],
    orderIds.length ? db.saleOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, code: true, walkInName: true, partner: { select: { name: true } } } }) : [],
    saleLineIds.length ? db.saleOrderLine.findMany({ where: { id: { in: saleLineIds } }, select: { id: true, salePrice: true, factorUsed: true } }) : [],
    returnIds.length ? db.goodsReturn.findMany({ where: { id: { in: returnIds } }, select: { id: true, code: true, partner: { select: { name: true } } } }) : [],
  ]);
  const purchaseOf = new Map(purchases.map((x) => [x.id, x])), orderOf = new Map(orders.map((x) => [x.id, x])), returnOf = new Map(returns.map((x) => [x.id, x]));
  const purchaseLineOf = new Map(purchaseLines.map((x) => [x.id, x])), saleLineOf = new Map(saleLines.map((x) => [x.id, x]));
  const perBase = (price: Prisma.Decimal, factor: Prisma.Decimal) => (factor.gt(0) ? price.div(factor) : price).toDecimalPlaces(2).toString();

  const opening = new Prisma.Decimal(before._sum.qtyIn ?? 0).minus(before._sum.qtyOut ?? 0);
  let balance = opening, inQty = new Prisma.Decimal(0), outQty = new Prisma.Decimal(0);
  const rows = ledger.map<XntDetailRow>((r) => {
    balance = balance.plus(r.qtyIn).minus(r.qtyOut); inQty = inQty.plus(r.qtyIn); outQty = outQty.plus(r.qtyOut);
    const docType = r.docType as string, isIn = new Prisma.Decimal(r.qtyIn).gt(0), isOut = new Prisma.Decimal(r.qtyOut).gt(0);
    let code: string | null = null, partner: string | null = null;
    if (docType === "PURCHASE") { const p = purchaseOf.get(r.docId); code = p?.code ?? null; partner = p?.partner.name ?? null; }
    else if (docType === "SALE" || docType === "PROCESSING_USE") { const o = orderOf.get(r.docId); code = o?.code ?? null; partner = o ? o.walkInName?.trim() || o.partner.name : null; }
    else if (docType === "RETURN_IN" || docType === "RETURN_SUPPLIER") { const g = returnOf.get(r.docId); code = g?.code ?? null; partner = g?.partner.name ?? null; }
    const pl = docType === "PURCHASE" ? purchaseLineOf.get(r.docLineId) : undefined, sl = docType === "SALE" ? saleLineOf.get(r.docLineId) : undefined;
    return {
      id: r.id, at: r.at.toISOString(), docType, label: LABEL[docType] ?? docType, href: HREF[docType]?.(r.docId) ?? null, code, partner,
      qtyIn: r.qtyIn.toString(), qtyOut: r.qtyOut.toString(), balance: balance.toString(),
      ...(pl ? { purchasePrice: perBase(pl.purchasePrice, pl.factorUsed) } : {}),
      ...(isIn && r.layer ? { unitCost: r.layer.unitCost.toDecimalPlaces(2).toString() } : {}),
      ...(sl ? { salePrice: perBase(sl.salePrice, sl.factorUsed) } : {}),
      ...(isOut ? { unitCostOut: r.unitCostOut.toDecimalPlaces(2).toString() } : {}),
    };
  });
  return redactDeep({ product, opening: opening.toString(), inQty: inQty.toString(), outQty: outQty.toString(), closing: balance.toString(), rows }, actor.perms);
}
