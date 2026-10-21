import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Actor } from "@/lib/permissions/scope";
import { assertCan } from "@/lib/permissions/guard";
import { ictYmd } from "@/lib/time";
import { writeAudit } from "@/server/audit/write";
import { dateOnly } from "@/server/bom/resolve";
import { DomainError } from "@/server/http/errors";

type Db = Prisma.TransactionClient | PrismaClient;
const money = z.number().finite().min(0).max(99_999_999_999).refine(n => Number(n.toFixed(4)) === n, "Tối đa 4 số thập phân.");
export const referenceCostPlanSchema = z.object({
  processingTypeId: z.number().int().positive().max(2_147_483_647),
  scope: z.enum(["PRODUCT", "TYPE"]),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
    const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Ngày không hợp lệ."),
  tonProductId: z.number().int().positive().max(2_147_483_647).nullable(),
  fixedPricePerM2: money.nullable(),
  tonQtyPerMeter: z.number().finite().positive().max(1_000_000).refine(n => Number(n.toFixed(6)) === n).default(1),
  feePerMeter: money.nullable(),
  auxFixedPerMeter: money.nullable().default(null),
  note: z.string().trim().max(300).default(""),
}).superRefine((v, ctx) => {
  if (v.scope === "PRODUCT" && !v.tonProductId) ctx.addIssue({ code: "custom", path: ["tonProductId"], message: "Chọn mã tôn đầu vào để tránh tính trùng với BOM." });
  if (v.scope === "TYPE" && (v.tonProductId !== null || v.fixedPricePerM2 !== null || v.auxFixedPerMeter !== null || v.feePerMeter === null)) ctx.addIssue({ code: "custom", path: ["feePerMeter"], message: "Mặc định của kiểu chỉ khai báo phí gia công." });
});

export function assertReferenceCostRead(actor: Actor) {
  assertCan(actor.perms, "product.view"); assertCan(actor.perms, "cost.view"); assertCan(actor.perms, "purchase_price.view");
}

function assertWriteScope(actor: Actor, scope: "PRODUCT" | "TYPE") {
  assertReferenceCostRead(actor);
  if (scope === "TYPE") assertCan(actor.perms, "catalog.manage");
  else if (!actor.perms.has("bom.manage")) assertCan(actor.perms, "product.manage");
}

/** Id các bản đã được chụp vào dòng đơn bán (planId/feePlanId) — bản đó không được xoá/ghi đè. */
export async function usedReferenceCostPlanIds(db: Db, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const keys = ids.map(String);
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT x AS id FROM (
      SELECT "referenceCostSnapshot"->>'planId' AS x FROM sale_order_lines WHERE "referenceCostSnapshot"->>'planId' = ANY(${keys}::text[])
      UNION
      SELECT "referenceCostSnapshot"->>'feePlanId' AS x FROM sale_order_lines WHERE "referenceCostSnapshot"->>'feePlanId' = ANY(${keys}::text[])
    ) t`;
  return new Set(rows.map(r => Number(r.id)));
}

export async function createReferenceCostPlan(db: Prisma.TransactionClient, actor: Actor, productId: number, input: z.infer<typeof referenceCostPlanSchema>, now = new Date()) {
  assertWriteScope(actor, input.scope);
  if (input.validFrom < ictYmd(now)) throw new DomainError("Ngày hiệu lực không được trước hôm nay; không thay đổi dự toán đơn cũ.", 400);
  await db.$queryRaw`SELECT id FROM processing_types WHERE id = ${input.processingTypeId} FOR UPDATE`;
  const [product, type, link] = await Promise.all([
    db.product.findUnique({ where: { id: productId }, select: { isActive: true, baseUnit: true } }),
    db.processingType.findUnique({ where: { id: input.processingTypeId }, select: { isActive: true } }),
    db.productProcessingRatio.findUnique({ where: { productId_processingTypeId: { productId, processingTypeId: input.processingTypeId } } }),
  ]);
  if (!product?.isActive || !type?.isActive || !link) throw new DomainError("Sản phẩm hoặc kiểu gia công không còn sử dụng/chưa được gắn.", 400);
  if (!isMeter(product.baseUnit)) throw new DomainError("Dự toán này áp dụng cho sản phẩm có đơn vị gốc mét dài (m/md).", 400);
  if (input.tonProductId !== null) {
    const ton = await db.product.findUnique({ where: { id: input.tonProductId }, select: { isActive: true, canUseAsMaterial: true } });
    if (!ton?.isActive || !ton.canUseAsMaterial) throw new DomainError("Mã tôn phải đang sử dụng và có khả năng làm nguyên liệu.", 400);
  }
  const target = input.scope === "PRODUCT" ? productId : null;
  const data = {
    productId: target, processingTypeId: input.processingTypeId,
    validFrom: dateOnly(input.validFrom), tonProductId: input.tonProductId,
    fixedPricePerM2: input.fixedPricePerM2, tonQtyPerMeter: input.tonQtyPerMeter, feePerMeter: input.feePerMeter,
    auxFixedPerMeter: input.auxFixedPerMeter,
    note: input.note || null,
  };
  // Cùng (đích, kiểu, ngày): chưa dùng trên đơn → ghi đè; đã dùng → buộc chọn ngày hiệu lực khác.
  const same = await db.referenceCostPlan.findFirst({ where: { productId: target, processingTypeId: input.processingTypeId, validFrom: data.validFrom } });
  if (same) {
    if ((await usedReferenceCostPlanIds(db, [same.id])).has(same.id)) throw new DomainError("Phiên bản cùng ngày này đã được dùng trên đơn hàng; chọn ngày hiệu lực khác.", 409);
    await db.referenceCostPlan.update({ where: { id: same.id }, data });
    await writeAudit(db, { userId: actor.userId, action: "reference-cost.update", entity: "ReferenceCostPlan", entityId: same.id, before: same, after: input });
    return { id: same.id };
  }
  const row = await db.referenceCostPlan.create({ data: { ...data, createdBy: actor.userId } });
  await writeAudit(db, { userId: actor.userId, action: "reference-cost.create", entity: "ReferenceCostPlan", entityId: row.id, after: input });
  return { id: row.id };
}

export async function deleteReferenceCostPlan(db: Prisma.TransactionClient, actor: Actor, productId: number, planId: number) {
  assertReferenceCostRead(actor);
  const plan = await db.referenceCostPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new DomainError("Không tìm thấy phiên bản dự toán.", 404);
  if (plan.productId !== null && plan.productId !== productId) throw new DomainError("Không tìm thấy phiên bản dự toán.", 404);
  if (plan.productId === null && !await db.productProcessingRatio.findUnique({ where: { productId_processingTypeId: { productId, processingTypeId: plan.processingTypeId } } })) throw new DomainError("Không tìm thấy phiên bản dự toán.", 404);
  assertWriteScope(actor, plan.productId === null ? "TYPE" : "PRODUCT");
  if ((await usedReferenceCostPlanIds(db, [planId])).has(planId)) throw new DomainError("Phiên bản này đã được dùng trên đơn hàng nên không xoá được. Hãy lưu phiên bản mới.", 409);
  await db.referenceCostPlan.delete({ where: { id: planId } });
  await writeAudit(db, { userId: actor.userId, action: "reference-cost.delete", entity: "ReferenceCostPlan", entityId: planId, before: plan });
  return { ok: true };
}

export const isMeter = (unit: string) => ["m", "md", "m dài", "mét", "mét dài"].includes(unit.trim().toLocaleLowerCase("vi"));

export async function effectiveReferenceCostPlans(db: Db, productId: number, processingTypeId: number, at: Date) {
  const where = { processingTypeId, validFrom: { lte: dateOnly(ictYmd(at)) } };
  const [plan, defaults] = await Promise.all([
    db.referenceCostPlan.findFirst({ where: { ...where, productId }, orderBy: { validFrom: "desc" }, include: { tonProduct: { select: { id: true, code: true, name: true, baseUnit: true } } } }),
    db.referenceCostPlan.findFirst({ where: { ...where, productId: null }, orderBy: { validFrom: "desc" } }),
  ]);
  return { plan, defaults };
}
