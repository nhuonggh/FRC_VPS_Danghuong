import { Prisma, type PrismaClient } from "@prisma/client";
import { can } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { DomainError } from "@/server/http/errors";
import { lastPurchaseCost } from "@/server/purchase/last-cost";
import { lastSalePricePerBase, priceForUnit } from "@/server/sales/pricing";

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * Giá vốn nhập lại cho hàng khách trả KHÔNG theo đơn (mục 45): vốn (FIFO, trên 1 đơn vị gốc) của lần bán gần nhất cho
 * chính khách này; chưa từng bán cho khách này → giá nhập gần nhất; không có cả hai → chặn (không nhập kho giá 0).
 * Bỏ qua dòng đơn nháp/đã hủy, dòng tôn xốp (vốn là của NVL, không phải mã bán) và dòng đang treo (vốn chưa có).
 */
export async function resolveReturnCostByProduct(db: Db, partnerId: number, productId: number, productCode: string): Promise<Prisma.Decimal> {
  const sold = await db.saleOrderLine.findFirst({
    where: { productId, processingTypeId: null, isProvisional: false, order: { partnerId, isCancelled: false, isDraft: false } },
    orderBy: [{ at: "desc" }, { id: "desc" }], select: { unitCostFifo: true },
  });
  if (sold) return sold.unitCostFifo;
  const bought = await lastPurchaseCost(db, productId);
  if (bought) return bought;
  throw new DomainError(`${productCode}: chưa có giá vốn tham chiếu (chưa bán cho khách này, chưa từng nhập) — hãy nhập kho mã này trước.`, 400);
}

/** Giá thỏa thuận mặc định khi trả NCC: giá nhập gần nhất từ chính NCC này (theo đơn vị gốc), không có thì của NCC khác. */
export async function lastPurchasePricePerBase(db: Db, productId: number, partnerId: number): Promise<{ perBase: Prisma.Decimal; forPartner: boolean } | null> {
  const pick = { purchasePrice: true, factorUsed: true } as const;
  const own = await db.purchaseLine.findFirst({ where: { productId, purchase: { partnerId, isCancelled: false } }, orderBy: [{ purchase: { at: "desc" } }, { id: "desc" }], select: pick });
  if (own) return { perBase: own.purchasePrice.times(own.factorUsed), forPartner: true };
  const any = await db.purchaseLine.findFirst({ where: { productId, purchase: { isCancelled: false } }, orderBy: [{ purchase: { at: "desc" } }, { id: "desc" }], select: pick });
  return any ? { perBase: any.purchasePrice.times(any.factorUsed), forPartner: false } : null;
}

export interface ReturnPricingDTO {
  productId: number;
  baseUnit: string;
  units: { unit: string; factor: string; suggestedPrice: string | null }[];
}

/** Gợi ý đơn giá cho màn trả hàng (45/47). Khách: giá bán gần nhất (cần sale_price.view); NCC: giá nhập gần nhất (cần purchase_price.view). */
export async function returnPricing(db: PrismaClient, actor: Actor, kind: "CUSTOMER" | "SUPPLIER", partnerId: number, productId: number): Promise<ReturnPricingDTO | null> {
  if (!can(actor.perms, kind === "CUSTOMER" ? "sale_price.view" : "purchase_price.view")) return null;
  const product = await db.product.findUnique({ where: { id: productId }, include: { units: { orderBy: { unit: "asc" } } } });
  if (!product) return null;
  const last = kind === "CUSTOMER" ? await lastSalePricePerBase(db, productId, partnerId) : await lastPurchasePricePerBase(db, productId, partnerId);
  const units = [{ unit: product.baseUnit, factor: new Prisma.Decimal(1) }, ...product.units.map((u) => ({ unit: u.unit, factor: u.factor }))];
  return { productId, baseUnit: product.baseUnit, units: units.map((u) => ({ unit: u.unit, factor: u.factor.toString(), suggestedPrice: last ? priceForUnit(last.perBase, u.factor).toString() : null })) };
}
