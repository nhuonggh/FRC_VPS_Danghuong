import type { Prisma, PrismaClient } from "@prisma/client";
import { sortToOrderBy, type ListParams } from "@/lib/query-params";
import { searchTextWhere } from "@/lib/search";
import { ictYmd } from "@/lib/time";
import { DomainError } from "@/server/http/errors";

type Db = Prisma.TransactionClient | PrismaClient;

export const BOM_FILTER_KEYS = ["processingType"] as const;

export interface BomListRow {
  id: number;
  productId: number;
  productCode: string;
  productName: string;
  processingTypeId: number;
  processingType: string;
  versionCount: number;
  /** Phiên bản đang hiệu lực hôm nay (ICT); null nếu chưa bản nào có hiệu lực. */
  current: { versionId: number; versionNo: number; validFrom: string; lineCount: number } | null;
  /** Ngày hiệu lực của phiên bản tương lai gần nhất (đã lên lịch), nếu có. */
  upcomingFrom: string | null;
}

export interface BomVersionDTO {
  id: number;
  versionNo: number;
  validFrom: string;
  status: "DRAFT" | "ACTIVE" | "CANCELLED";
  note: string | null;
  createdAt: string;
  createdBy: number;
  /** Đang hiệu lực hôm nay (bản ACTIVE mới nhất có validFrom <= hôm nay). */
  isCurrent: boolean;
  lines: { id: number; materialProductId: number; materialCode: string; materialName: string; baseUnit: string; qtyPerUnit: string; note: string | null }[];
}

export interface BomDetailDTO {
  id: number;
  productId: number;
  productCode: string;
  productName: string;
  processingTypeId: number;
  processingType: string;
  /** Tỷ lệ m²/md (null = chưa khai báo). */
  areaRatio: string | null;
  versions: BomVersionDTO[];
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function bomWhere(params: ListParams): Prisma.BomWhereInput {
  const and: Prisma.BomWhereInput[] = [{ product: searchTextWhere(params.q) }];
  const pt = (params.filters.processingType ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (pt.length) and.push({ processingTypeId: { in: pt } });
  return { AND: and };
}

export async function listBoms(db: Db, params: ListParams, now: Date = new Date()) {
  const where = bomWhere(params);
  const today = ictYmd(now);
  const [rows, total] = await Promise.all([
    db.bom.findMany({
      where,
      orderBy: params.sort ? sortToOrderBy(params.sort, ["createdAt"], { createdAt: "desc" }) : { product: { code: "asc" } },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: {
        product: { select: { code: true, name: true } },
        processingType: { select: { name: true } },
        versions: { where: { status: "ACTIVE" }, orderBy: [{ validFrom: "desc" }, { versionNo: "desc" }], include: { _count: { select: { lines: true } } } },
      },
    }),
    db.bom.count({ where }),
  ]);
  const out: BomListRow[] = rows.map((b) => {
    const current = b.versions.find((v) => ymd(v.validFrom) <= today) ?? null;
    const upcoming = b.versions.filter((v) => ymd(v.validFrom) > today).at(-1) ?? null;
    return {
      id: b.id,
      productId: b.productId,
      productCode: b.product.code,
      productName: b.product.name,
      processingTypeId: b.processingTypeId,
      processingType: b.processingType.name,
      versionCount: b.versions.length,
      current: current && { versionId: current.id, versionNo: current.versionNo, validFrom: ymd(current.validFrom), lineCount: current._count.lines },
      upcomingFrom: upcoming ? ymd(upcoming.validFrom) : null,
    };
  });
  return { rows: out, total };
}

export async function getBom(db: Db, id: number, now: Date = new Date()): Promise<BomDetailDTO> {
  const b = await db.bom.findUnique({
    where: { id },
    include: {
      product: { select: { code: true, name: true } },
      processingType: { select: { name: true } },
      versions: {
        orderBy: [{ validFrom: "desc" }, { versionNo: "desc" }],
        include: { lines: { orderBy: { id: "asc" }, include: { material: { select: { code: true, name: true, baseUnit: true } } } } },
      },
    },
  });
  if (!b) throw new DomainError("Không tìm thấy định mức.", 404);
  const today = ictYmd(now);
  const currentId = b.versions.find((v) => v.status === "ACTIVE" && ymd(v.validFrom) <= today)?.id;
  return {
    id: b.id,
    productId: b.productId,
    productCode: b.product.code,
    productName: b.product.name,
    processingTypeId: b.processingTypeId,
    processingType: b.processingType.name,
    areaRatio: (await db.productProcessingRatio.findUnique({ where: { productId_processingTypeId: { productId: b.productId, processingTypeId: b.processingTypeId } }, select: { ratio: true } }))?.ratio.toString() ?? null,
    versions: b.versions.map((v) => ({
      id: v.id,
      versionNo: v.versionNo,
      validFrom: ymd(v.validFrom),
      status: v.status,
      note: v.note,
      createdAt: v.createdAt.toISOString(),
      createdBy: v.createdBy,
      isCurrent: v.id === currentId,
      lines: v.lines.map((l) => ({
        id: l.id,
        materialProductId: l.materialProductId,
        materialCode: l.material.code,
        materialName: l.material.name,
        baseUnit: l.material.baseUnit,
        qtyPerUnit: l.qtyPerUnit.toString(),
        note: l.note,
      })),
    })),
  };
}
