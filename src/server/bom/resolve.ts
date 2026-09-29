import type { Prisma, PrismaClient } from "@prisma/client";
import { ictYmd } from "@/lib/time";
import { DomainError } from "@/server/http/errors";

type Db = Prisma.TransactionClient | PrismaClient;

export class BomNotFoundError extends DomainError {
  constructor(message = "Chưa có định mức hiệu lực cho sản phẩm và kiểu gia công này.") {
    super(message, 404, "BOM_NOT_FOUND");
    this.name = "BomNotFoundError";
  }
}

/** Snapshot chỉ-đọc của một phiên bản BOM (D-20). Plan 04 lưu `versionId` vào dòng bán khi dùng. */
export interface BomSnapshot {
  bomId: number;
  versionId: number;
  versionNo: number;
  validFrom: string; // yyyy-mm-dd (ICT)
  productId: number;
  processingTypeId: number;
  lines: { materialProductId: number; qtyPerUnit: string }[];
}

export const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

/**
 * Chọn phiên bản BOM đang hiệu lực tại thời điểm `at` (D-20): chỉ bản ACTIVE có validFrom <= ngày ICT(at),
 * lấy bản mới nhất. Không có → BomNotFoundError. Hai bản cùng ngày (DB đã chặn; kiểm lại để fail-closed) → lỗi rõ.
 */
export async function resolveBom(db: Db, productId: number, processingTypeId: number, at: Date): Promise<BomSnapshot> {
  const bom = await db.bom.findUnique({
    where: { productId_processingTypeId: { productId, processingTypeId } },
    include: { processingType: { select: { isActive: true } } },
  });
  if (!bom || !bom.processingType.isActive) throw new BomNotFoundError();

  const top = await db.bomVersion.findMany({
    where: { bomId: bom.id, status: "ACTIVE", validFrom: { lte: dateOnly(ictYmd(at)) } },
    orderBy: [{ validFrom: "desc" }, { versionNo: "desc" }],
    take: 2,
    include: { lines: { orderBy: { id: "asc" } } },
  });
  const [v, next] = top;
  if (!v) throw new BomNotFoundError();
  if (next && next.validFrom.getTime() === v.validFrom.getTime()) {
    throw new DomainError("Định mức có hai phiên bản cùng ngày hiệu lực — liên hệ quản trị để xử lý.", 409, "BOM_AMBIGUOUS");
  }
  return {
    bomId: bom.id,
    versionId: v.id,
    versionNo: v.versionNo,
    validFrom: v.validFrom.toISOString().slice(0, 10),
    productId,
    processingTypeId,
    lines: v.lines.map((l) => ({ materialProductId: l.materialProductId, qtyPerUnit: l.qtyPerUnit.toString() })),
  };
}
