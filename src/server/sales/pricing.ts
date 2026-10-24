import { Prisma, type PrismaClient } from "@prisma/client";
import { can } from "@/lib/permissions/guard";
import { canViewOrderAnalysis } from "@/lib/permissions/order-analysis";
import type { Actor } from "@/lib/permissions/scope";
import { getOpenPeriod } from "@/server/period/guard";
import { lastPurchaseCost } from "@/server/purchase/last-cost";
import { stockProductId } from "@/server/stock-lanes";
import { costReference, type CostReference, type IssueMode } from "./cost-reference";

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * Giá bán gần nhất TRÊN MỘT ĐƠN VỊ GỐC (đơn giá dòng × hệ số: 1 đơn vị gốc = `factorUsed` đơn vị dòng).
 * `processingTypeId` ⇒ chỉ xét các dòng cùng kiểu gia công (giá tôn xốp khác giá tôn phẳng). `forPartner` = của khách này; chưa mua thì lấy của khách CÙNG NHÓM khách hàng (không lẫn khách lẻ với thợ); nhóm chưa ai mua thì dùng giá xuất mặc định của sản phẩm. Bỏ qua đơn đã hủy.
 */
export async function lastSalePricePerBase(db: Db, productId: number, partnerId: number, processingTypeId?: number | null): Promise<{ perBase: Prisma.Decimal; forPartner: boolean; source: "partner" | "group" | "default" } | null> {
  const pick = { salePrice: true, factorUsed: true } as const;
  const type = processingTypeId ? { processingTypeId } : {};
  const own = await db.saleOrderLine.findFirst({ where: { productId, ...type, order: { partnerId, isCancelled: false, isDraft: false } }, orderBy: [{ at: "desc" }, { id: "desc" }], select: pick });
  if (own) return { perBase: own.salePrice.times(own.factorUsed), forPartner: true, source: "partner" };
  const me = await db.partner.findUnique({ where: { id: partnerId }, select: { groupId: true } });
  const sameGroup = me ? await db.saleOrderLine.findFirst({ where: { productId, ...type, order: { isCancelled: false, isDraft: false, partner: { groupId: me.groupId } } }, orderBy: [{ at: "desc" }, { id: "desc" }], select: pick }) : null;
  if (sameGroup) return { perBase: sameGroup.salePrice.times(sameGroup.factorUsed), forPartner: false, source: "group" };
  // Chưa từng bán (và không lọc theo kiểu gia công): lấy giá xuất mặc định khai ở sản phẩm.
  if (processingTypeId) return null;
  const def = await db.product.findUnique({ where: { id: productId }, select: { salePrice: true } });
  return def?.salePrice ? { perBase: def.salePrice, forPartner: false, source: "default" } : null;
}

/** Giá gợi ý theo đơn vị của dòng (factor = số đơn vị dòng trên một đơn vị gốc), làm tròn 2 số. */
export const priceForUnit = (perBase: Prisma.Decimal, factor: Prisma.Decimal.Value) =>
  perBase.div(factor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Giá vốn tham khảo tóm tắt (đơn vị gốc) cho người không có `order.analysis.view`. */
export interface CostHint { perBase: string | null; areaRatio?: string; message?: string }
const HINT_ACTOR: Actor = { userId: 0, perms: new Set(["order.analysis.view", "cost.view", "purchase_price.view"]) };

export interface SalePricingDTO {
  costReference?: CostReference;
  /** Chỉ có khi actor có `sale.cost_hint.view` mà không có quyền xem đầy đủ (`costReference`). */
  costHint?: CostHint;
  productId: number;
  baseUnit: string;
  /** `suggestedPrice`: giá gần nhất quy ra đơn vị này (đúng giá server chấp nhận khi thiếu quyền sửa giá). */
  units: { unit: string; factor: string; suggestedPrice: string | null }[];
  /** Chỉ có khi actor có `stock.view`. */
  onHand?: string;
  /** Giá bán gần nhất theo đơn vị gốc (khách này, hoặc khách cùng nhóm nếu khách này chưa mua). */
  lastSalePrice: string | null;
  lastSalePriceForPartner: boolean;
  /** Nguồn giá: khách này / khách cùng nhóm / giá xuất mặc định của sản phẩm. */
  lastSalePriceSource?: "partner" | "group" | "default";
  /** Chỉ có khi actor có `purchase_price.view`. */
  lastPurchasePrice?: string | null;
}

/** Dữ liệu gợi ý cho màn bán hàng (31): tồn, giá bán gần nhất, giá nhập gần nhất — mỗi thứ chỉ khi đủ quyền. */
export async function salePricing(db: PrismaClient, actor: Actor, partnerId: number, productId: number, processingTypeId?: number | null, at = new Date(), mode: IssueMode = "LEGACY"): Promise<SalePricingDTO | null> {
  if (!can(actor.perms, "sale_price.view")) return null;
  // 3 truy vấn độc lập chạy song song (trước: nối tiếp).
  const [product, last, stockId] = await Promise.all([
    db.product.findUnique({ where: { id: productId }, include: { units: { orderBy: { unit: "asc" } } } }),
    lastSalePricePerBase(db, productId, partnerId, processingTypeId),
    stockProductId(db, productId, processingTypeId),
  ]);
  if (!product) return null;
  const out: SalePricingDTO = {
    productId,
    baseUnit: product.baseUnit,
    units: [{ unit: product.baseUnit, factor: new Prisma.Decimal(1) }, ...product.units.map((u) => ({ unit: u.unit, factor: u.factor }))].map((u) => ({
      unit: u.unit, factor: u.factor.toString(), suggestedPrice: last ? priceForUnit(last.perBase, u.factor).toString() : null,
    })),
    lastSalePrice: last ? last.perBase.toString() : null,
    lastSalePriceForPartner: last?.forPartner ?? false,
    ...(last ? { lastSalePriceSource: last.source } : {}),
  };
  const onHandP = can(actor.perms, "stock.view") ? (async () => {
    const period = await getOpenPeriod(db);
    const [layers, pending] = await Promise.all([
      db.costLayer.aggregate({ where: { periodId: period.id, productId: stockId }, _sum: { qtyRemaining: true } }),
      db.stockLedger.aggregate({ where: { periodId: period.id, productId: stockId }, _sum: { qtyProvisional: true } }),
    ]);
    return (layers._sum.qtyRemaining ?? new Prisma.Decimal(0)).minus(pending._sum.qtyProvisional ?? 0).toString();
  })() : Promise.resolve(undefined);
  const purchaseP = canViewOrderAnalysis(actor.perms) && can(actor.perms, "purchase_price.view")
    ? lastPurchaseCost(db, stockId).then((c) => c?.toString() ?? null) : Promise.resolve(undefined);
  const [onHand, lastPurchase, reference] = await Promise.all([onHandP, purchaseP, costReference(db, actor, productId, processingTypeId ?? null, at, mode)]);
  if (onHand !== undefined) out.onHand = onHand;
  if (lastPurchase !== undefined) out.lastPurchasePrice = lastPurchase;
  if (reference) out.costReference = reference;
  else if (can(actor.perms, "sale.cost_hint.view")) {
    // Chỉ lấy MỘT con số tổng; nguồn, thành phần, định mức và giá nhập chi tiết không rời server.
    const full = await costReference(db, HINT_ACTOR, productId, processingTypeId ?? null, at, mode);
    const perBase = full?.primary?.perBase ?? null;
    out.costHint = { perBase, ...(full?.areaRatio ? { areaRatio: full.areaRatio } : {}), ...(perBase === null ? { message: "Chưa đủ dữ liệu giá vốn tham khảo." } : {}) };
  }
  return out;
}
