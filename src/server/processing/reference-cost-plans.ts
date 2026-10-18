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
  note: z.string().trim().max(300).default(""),
}).superRefine((v, ctx) => {
  if (v.scope === "PRODUCT" && !v.tonProductId) ctx.addIssue({ code: "custom", path: ["tonProductId"], message: "Chọn mã tôn đầu vào để tránh tính trùng với BOM." });
  if (v.scope === "TYPE" && (v.tonProductId !== null || v.fixedPricePerM2 !== null || v.feePerMeter === null)) ctx.addIssue({ code: "custom", path: ["feePerMeter"], message: "Mặc định của kiểu chỉ khai báo phí gia công." });
});

export function assertReferenceCostRead(actor: Actor) {
  assertCan(actor.perms, "product.view"); assertCan(actor.perms, "cost.view"); assertCan(actor.perms, "purchase_price.view");
}

export async function createReferenceCostPlan(db: Prisma.TransactionClient, actor: Actor, productId: number, input: z.infer<typeof referenceCostPlanSchema>, now = new Date()) {
  assertReferenceCostRead(actor);
  if (input.scope === "TYPE") assertCan(actor.perms, "catalog.manage");
  else if (!actor.perms.has("bom.manage")) assertCan(actor.perms, "product.manage");
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
  const row = await db.referenceCostPlan.create({ data: {
    productId: input.scope === "PRODUCT" ? productId : null, processingTypeId: input.processingTypeId,
    validFrom: dateOnly(input.validFrom), tonProductId: input.tonProductId,
    fixedPricePerM2: input.fixedPricePerM2, tonQtyPerMeter: input.tonQtyPerMeter, feePerMeter: input.feePerMeter,
    note: input.note || null, createdBy: actor.userId,
  } });
  await writeAudit(db, { userId: actor.userId, action: "reference-cost.create", entity: "ReferenceCostPlan", entityId: row.id, after: input });
  return { id: row.id };
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
