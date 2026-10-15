import type { PriceBasis, Prisma, PrismaClient } from "@prisma/client";
import { parseDimNote } from "@/lib/length-expr";

type Db = Prisma.TransactionClient | PrismaClient;

export interface AreaLineInput {
  productId: number; unit: string; baseUnit: string; note: string | null;
  processingTypeId: number | null; type: { priceBasis: PriceBasis; ratio: Prisma.Decimal | null } | null;
}

/**
 * Tỷ lệ m²/md để HIỂN THỊ/IN dòng theo m²: chỉ dòng có kiểu gia công tính giá theo m² và đang ở đơn vị gốc (md), còn lại null.
 * Ưu tiên tỷ lệ đã ghi trong ghi chú dòng (`7,1 m × 1,08 × 7 = …`), rồi tỷ lệ riêng của sản phẩm × kiểu, rồi mặc định của kiểu, cuối cùng 1.
 * Giá lưu trong DB vẫn là giá/md: giá/m² = giá/md ÷ tỷ lệ.
 */
export async function areaRatiosOf(db: Db, lines: readonly AreaLineInput[]): Promise<(number | null)[]> {
  const wanted = lines.filter((l) => l.type?.priceBasis === "AREA" && l.unit === l.baseUnit && l.processingTypeId !== null);
  const rows = wanted.length
    ? await db.productProcessingRatio.findMany({ where: { OR: wanted.map((l) => ({ productId: l.productId, processingTypeId: l.processingTypeId! })) }, select: { productId: true, processingTypeId: true, ratio: true } })
    : [];
  const own = new Map(rows.map((r) => [`${r.productId}:${r.processingTypeId}`, r.ratio === null ? null : Number(r.ratio)]));
  return lines.map((l) => {
    if (l.type?.priceBasis !== "AREA" || l.unit !== l.baseUnit || l.processingTypeId === null) return null;
    const r = parseDimNote(l.note)?.ratio ?? own.get(`${l.productId}:${l.processingTypeId}`) ?? (l.type.ratio === null ? null : Number(l.type.ratio)) ?? 1;
    return r > 0 ? r : null;
  });
}
