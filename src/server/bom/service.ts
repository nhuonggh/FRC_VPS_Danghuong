import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { ictYmd } from "@/lib/time";
import { writeAudit } from "@/server/audit/write";
import { DomainError, FieldConflictError, ValidationError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { dateOnly } from "./resolve";
import { BOM_MATERIAL_KINDS, BOM_TARGET_KINDS, type CreateBomVersionInput } from "./schemas";

type Db = Prisma.TransactionClient;

const KIND_LABEL: Record<string, string> = { HANG: "Hàng hóa", NVL: "Nguyên vật liệu", THANH_PHAM: "Thành phẩm", PHU_KIEN: "Phụ kiện" };
const kinds = (list: readonly string[]) => list.map((k) => KIND_LABEL[k]).join(", ");

/** Kiểm dữ liệu tham chiếu của phiên bản mới; lỗi tiếng Việt, gộp theo từng ô. */
async function validateRefs(db: Db, input: CreateBomVersionInput) {
  const [product, processingType, materials] = await Promise.all([
    db.product.findUnique({ where: { id: input.productId }, select: { id: true, code: true, kind: true, isActive: true } }),
    db.processingType.findUnique({ where: { id: input.processingTypeId }, select: { id: true, name: true, isActive: true } }),
    db.product.findMany({ where: { id: { in: input.lines.map((l) => l.materialProductId) } }, select: { id: true, code: true, kind: true, isActive: true } }),
  ]);
  if (!product) throw new DomainError("Không tìm thấy thành phẩm.", 404);
  if (!processingType) throw new DomainError("Không tìm thấy kiểu gia công.", 404);
  if (!processingType.isActive) throw new ValidationError("Kiểu gia công đã tắt.", { processingTypeId: "Kiểu gia công đã tắt." });
  if (!product.isActive) throw new ValidationError("Thành phẩm đã tắt.", { productId: "Sản phẩm đã tắt." });
  if (!(BOM_TARGET_KINDS as readonly string[]).includes(product.kind)) {
    const msg = `Chỉ khai báo định mức cho: ${kinds(BOM_TARGET_KINDS)}.`;
    throw new ValidationError(msg, { productId: msg });
  }
  const byId = new Map(materials.map((m) => [m.id, m]));
  const fields: Record<string, string> = {};
  input.lines.forEach((l, i) => {
    const m = byId.get(l.materialProductId);
    if (!m) fields[`lines.${i}.materialProductId`] = "Không tìm thấy nguyên vật liệu.";
    else if (!m.isActive) fields[`lines.${i}.materialProductId`] = `${m.code} đã tắt.`;
    else if (!(BOM_MATERIAL_KINDS as readonly string[]).includes(m.kind)) fields[`lines.${i}.materialProductId`] = `${m.code} không phải ${kinds(BOM_MATERIAL_KINDS)}.`;
  });
  if (Object.keys(fields).length) throw new ValidationError(Object.values(fields)[0]!, fields);
  return { product, processingType };
}

/**
 * Tạo phiên bản BOM mới (D-19: không sửa bản cũ). Khoá hàng `boms` để hai người lưu cùng lúc được xếp hàng:
 * người sau thấy ngày trùng → 409 có kiểm soát (unique index DB là lớp chặn cuối).
 * Ngày hiệu lực không được ở quá khứ (sẽ đổi định mức của chứng từ cũ chưa chốt) — trừ phiên bản ĐẦU TIÊN của BOM.
 */
export async function createBomVersion(db: Db, actor: Actor, input: CreateBomVersionInput, now: Date = new Date()) {
  assertCan(actor.perms, "bom.manage");
  const { product, processingType } = await validateRefs(db, input);

  await db.$executeRaw`
    INSERT INTO boms ("productId", "processingTypeId", "createdBy", "createdAt")
    VALUES (${input.productId}, ${input.processingTypeId}, ${actor.userId}, now())
    ON CONFLICT ("productId", "processingTypeId") DO NOTHING`;
  const [bom] = await db.$queryRaw<{ id: number }[]>`
    SELECT id FROM boms WHERE "productId" = ${input.productId} AND "processingTypeId" = ${input.processingTypeId} FOR UPDATE`;
  if (!bom) throw new DomainError("Không tạo được định mức, vui lòng thử lại.", 409);

  const existing = await db.bomVersion.findMany({ where: { bomId: bom.id }, select: { versionNo: true, validFrom: true, status: true } });
  const isFirst = existing.length === 0;
  if (!isFirst && input.validFrom < ictYmd(now)) {
    throw new ValidationError("Ngày hiệu lực không được trước hôm nay.", { validFrom: "Ngày hiệu lực không được trước hôm nay." });
  }
  const validFrom = dateOnly(input.validFrom);
  if (existing.some((v) => v.status !== "CANCELLED" && v.validFrom.getTime() === validFrom.getTime())) {
    throw new FieldConflictError("Đã có phiên bản định mức cùng ngày hiệu lực.", { validFrom: "Đã có phiên bản cùng ngày hiệu lực." });
  }
  const versionNo = existing.reduce((max, v) => Math.max(max, v.versionNo), 0) + 1;

  const version = await db.bomVersion.create({
    data: {
      bomId: bom.id,
      versionNo,
      validFrom,
      status: "ACTIVE",
      note: input.note || null,
      createdBy: actor.userId,
      lines: {
        create: input.lines.map((l) => ({
          materialProductId: l.materialProductId,
          qtyPerUnit: new Prisma.Decimal(l.qtyPerUnit),
          note: l.note || null,
        })),
      },
    },
  });
  await writeAudit(db, {
    userId: actor.userId,
    action: "bom.create_version",
    entity: "Bom",
    entityId: bom.id,
    after: { productCode: product.code, processingType: processingType.name, versionNo, validFrom: input.validFrom, lineCount: input.lines.length },
  });
  return { bomId: bom.id, versionId: version.id, versionNo };
}

export async function createBomVersionIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: CreateBomVersionInput) {
  assertCan(actor.perms, "bom.manage");
  return withIdempotency(prisma, { userId: actor.userId, scope: "bom.create_version", key }, (tx) => createBomVersion(tx, actor, input));
}

/** Huỷ phiên bản CHƯA có hiệu lực (validFrom > hôm nay ICT). Không xoá dữ liệu; nhả ngày hiệu lực cho bản khác. */
export async function cancelBomVersion(db: Db, actor: Actor, versionId: number, now: Date = new Date()) {
  assertCan(actor.perms, "bom.manage");
  const v = await db.bomVersion.findUnique({ where: { id: versionId }, include: { bom: { include: { product: { select: { code: true } } } } } });
  if (!v) throw new DomainError("Không tìm thấy phiên bản định mức.", 404);
  if (v.status === "CANCELLED") throw new DomainError("Phiên bản đã huỷ.", 409);
  if (v.validFrom.toISOString().slice(0, 10) <= ictYmd(now)) {
    throw new DomainError("Phiên bản đã có hiệu lực, không huỷ được. Hãy tạo phiên bản mới.", 409);
  }
  await db.bomVersion.update({ where: { id: versionId }, data: { status: "CANCELLED" } });
  await writeAudit(db, {
    userId: actor.userId,
    action: "bom.cancel_version",
    entity: "Bom",
    entityId: v.bomId,
    before: { productCode: v.bom.product.code, versionNo: v.versionNo, status: v.status },
    after: { status: "CANCELLED" },
  });
}

const ratioOf = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 99 || Number(n.toFixed(4)) !== n) throw new ValidationError("Tỷ lệ phải lớn hơn 0 và tối đa 4 chữ số thập phân.");
  return new Prisma.Decimal(n);
};

/**
 * Đặt tỷ lệ m²/md của (sản phẩm × kiểu gia công) — không cần có định mức.
 * `onlyIfMissing` (người bán): chỉ ghi khi chưa có — đã có thì giữ nguyên, việc sửa thuộc về người quản lý (`bom.manage` hoặc `product.manage`).
 */
export async function setProcessingRatio(db: Db, actor: Actor, o: { productId: number; processingTypeId: number; ratio: number; onlyIfMissing: boolean }) {
  if (o.onlyIfMissing) assertCan(actor.perms, "order.create");
  else if (!actor.perms.has("bom.manage") && !actor.perms.has("product.manage")) assertCan(actor.perms, "bom.manage");
  const ratio = ratioOf(o.ratio);
  const [product, type] = await Promise.all([db.product.findUnique({ where: { id: o.productId }, select: { id: true } }), db.processingType.findUnique({ where: { id: o.processingTypeId }, select: { id: true } })]);
  if (!product || !type) throw new DomainError("Không tìm thấy sản phẩm hoặc kiểu gia công.", 404);
  const key = { productId_processingTypeId: { productId: o.productId, processingTypeId: o.processingTypeId } };
  const cur = await db.productProcessingRatio.findUnique({ where: key });
  if (o.onlyIfMissing && cur) return { ratio: cur.ratio.toString(), saved: false };
  await db.productProcessingRatio.upsert({ where: key, create: { productId: o.productId, processingTypeId: o.processingTypeId, ratio, updatedBy: actor.userId }, update: { ratio, updatedBy: actor.userId } });
  await writeAudit(db, { userId: actor.userId, action: "product.set_processing_ratio", entity: "Product", entityId: o.productId, before: { processingTypeId: o.processingTypeId, ratio: cur?.ratio.toString() ?? null }, after: { processingTypeId: o.processingTypeId, ratio: ratio.toString() } });
  return { ratio: ratio.toString(), saved: true };
}
