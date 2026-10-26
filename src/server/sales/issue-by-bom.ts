import { Prisma, type PrismaClient } from "@prisma/client";
import { resolveBom } from "@/server/bom";
import { DomainError } from "@/server/http/errors";
import { stockProductId } from "@/server/stock-lanes";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/**
 * BÁN HÀNG GIA CÔNG THEO ĐỊNH MỨC (mã 15, D-20): dòng bán có kiểu gia công (tôn xốp / 1 lớp / 6 sóng / 11 sóng) KHÔNG xuất
 * chính mã bán mà xuất từng nguyên vật liệu theo định mức (BOM) hiệu lực tại NGÀY ĐƠN; phiên bản BOM được ghi lại
 * (`bomVersionId`) làm snapshot nên đổi BOM sau này không đổi đơn cũ.
 *
 * RANH GIỚI: đây là bán tôn xốp do xưởng làm từ NVL của xưởng. KHÔNG phải gia công thuê (tôn của khách không nhập kho, không
 * trừ tôn cuộn) — phần đó thuộc plan 06-E3.
 */
export interface BomIssue { productId: number; qtyBase: Prisma.Decimal }
export interface BomIssuePlan { issues: BomIssue[]; bomVersionId: number; /** Tỷ lệ trừ chính mã bán đã áp (null = không trừ thêm) — ghi lại làm snapshot trên dòng. */ mainStockRatio: Prisma.Decimal | null }

/** qty NVL = định mức/đơn vị × SL gốc của dòng, làm tròn 3 số (HALF_UP). */
const materialQty = (perUnit: Prisma.Decimal.Value, qtyBase: Prisma.Decimal) => D(perUnit).times(qtyBase).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);

export async function planBomIssues(
  db: Db,
  o: {
    /** Số thứ tự dòng (1-based) cho thông báo lỗi. */ n: number;
    product: { id: number; code: string }; processingTypeId: number; qtyBase: Prisma.Decimal; at: Date;
    /** Phiên bản đã dùng của dòng đang sửa (dòng không đổi mã/kiểu gia công giữ định mức cũ). */ pinnedVersionId?: number | null;
    /** Tỷ lệ trừ kho của kiểu gia công: trừ thêm CHÍNH mã bán (kho theo kiểu) × tỷ lệ; null/≤0 = không trừ thêm. Dòng đã lưu truyền lại snapshot của dòng. */ mainStockRatio?: Prisma.Decimal.Value | null;
  },
): Promise<BomIssuePlan> {
  const ratio = o.mainStockRatio != null && D(o.mainStockRatio).gt(0) ? D(o.mainStockRatio) : null;
  /** Dòng trừ chính mã bán — đặt ĐẦU danh sách (tôn là vật tư chính, NVL phụ theo định mức đi sau). */
  const withMain = async (issues: BomIssue[]): Promise<BomIssue[]> => ratio ? [{ productId: await stockProductId(db, o.product.id, o.processingTypeId), qtyBase: materialQty(ratio, o.qtyBase) }, ...issues] : issues;
  if (o.pinnedVersionId) {
    const version = await db.bomVersion.findUniqueOrThrow({ where: { id: o.pinnedVersionId }, include: { lines: { orderBy: { id: "asc" } } } });
    return { bomVersionId: o.pinnedVersionId, mainStockRatio: ratio, issues: await withMain(version.lines.map((l) => ({ productId: l.materialProductId, qtyBase: materialQty(l.qtyPerUnit, o.qtyBase) }))) };
  }
  const bom = await resolveBom(db, o.product.id, o.processingTypeId, o.at).catch((e: unknown) => {
    if (e instanceof DomainError && e.status === 404) throw new DomainError(`Dòng ${o.n}: ${o.product.code} chưa có định mức hiệu lực cho kiểu gia công đã chọn.`, 400);
    throw e;
  });
  const ids = [o.product.id, ...bom.lines.map((l) => l.materialProductId)];
  const products = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, isActive: true, canProduce: true, canUseAsMaterial: true } });
  const target = products.find((p) => p.id === o.product.id);
  if (!target?.canProduce) throw new DomainError(`Dòng ${o.n}: ${o.product.code} chưa bật khả năng được sản xuất.`, 400);
  for (const l of bom.lines) {
    const p = products.find((p) => p.id === l.materialProductId);
    if (!p?.isActive || !p.canUseAsMaterial) throw new DomainError(`Dòng ${o.n}: nguyên liệu ${p?.code ?? l.materialProductId} đã ngừng sử dụng hoặc chưa bật khả năng làm nguyên liệu.`, 400);
  }
  const issues = await withMain(bom.lines.map((l) => ({ productId: l.materialProductId, qtyBase: materialQty(l.qtyPerUnit, o.qtyBase) })));
  if (issues.some((i) => !i.qtyBase.gt(0))) throw new DomainError(`Dòng ${o.n}: số lượng quá nhỏ so với định mức nguyên vật liệu.`, 400);
  return { bomVersionId: bom.versionId, issues, mainStockRatio: ratio };
}
