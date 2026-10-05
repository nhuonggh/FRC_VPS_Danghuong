import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { normalizeSearch } from "@/lib/search";
import { createDeliveryNoteCore } from "@/server/delivery/service";
import { createDeposit } from "@/server/deposits/service";
import { DomainError } from "@/server/http/errors";
import { withIdempotentInventoryTx } from "@/server/idempotency/with-inventory-tx";
import { docTimestamp } from "@/server/inventory";
import { lineAmountOf } from "./queries";
import type { SaleOrderInput } from "./schemas";
import { assertWriter, createSaleOrder, planLines } from "./service";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Mã khách chung cho bán lẻ tại quầy (khách không cần tạo hồ sơ). */
export const WALK_IN_CODE = "KHL";

/**
 * Phần "bán tại quầy" đi kèm đơn: khách lẻ, thu tiền ngay, giao ngay (khách tự chở).
 * Tất cả nằm CÙNG giao dịch với việc lập đơn: lỗi bất kỳ bước nào ⇒ không có đơn/phiếu thu/phiếu giao nào được ghi.
 */
export const checkoutSchema = z.object({
  /** Có = khách lẻ: đơn gắn khách chung KHL, tên/SĐT chỉ ghi trên đơn. */
  walkIn: z.object({ name: z.string().trim().max(120, "Tên tối đa 120 ký tự."), phone: z.string().trim().max(30, "SĐT tối đa 30 ký tự.") }).optional(),
  /** Khách tự chở: tạo luôn phiếu giao đủ số lượng. */
  pickupNow: z.boolean().optional(),
  /** Thu tiền ngay (phiếu thu gắn đơn). amount = 0 → không thu. */
  payment: z.object({
    amount: z.number({ invalid_type_error: "Nhập số tiền thu." }).finite().min(0, "Số tiền không được âm.").max(99_999_999_999).refine((n) => Number(n.toFixed(2)) === n, "Tối đa 2 chữ số thập phân."),
    cashAccountId: z.number().int().positive().nullable().optional(),
    note: z.string().trim().max(300),
  }).optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

/** Khách chung KHL: tạo lần đầu cần dùng (nhóm khách đầu tiên đang dùng, không cho ghi nợ). */
export async function ensureWalkInCustomer(prisma: PrismaClient): Promise<number> {
  const find = () => prisma.partner.findUnique({ where: { code: WALK_IN_CODE } });
  let p = await find();
  if (!p) {
    const group = await prisma.partnerGroup.findFirst({ where: { isActive: true }, orderBy: { id: "asc" } });
    if (!group) throw new DomainError("Chưa có nhóm khách hàng nào để tạo khách lẻ. Hãy thêm nhóm khách hàng trước.", 409);
    try {
      p = await prisma.partner.create({ data: { code: WALK_IN_CODE, name: "Khách lẻ", searchText: normalizeSearch(`${WALK_IN_CODE} Khách lẻ`), groupId: group.id, isCustomer: true, allowCredit: false } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") p = await find(); else throw e;
    }
  }
  if (!p || !p.isCustomer || !p.isActive || p.mergedIntoId !== null) throw new DomainError("Khách lẻ (KHL) không dùng được — hãy bật lại hoặc đổi mã khác ở danh mục khách hàng.", 409);
  return p.id;
}

export async function createCheckoutSaleOrderIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: SaleOrderInput, checkout: CheckoutInput, now: Date = new Date()) {
  assertWriter(actor, "order.create");
  const pay = checkout.payment && checkout.payment.amount > 0 ? checkout.payment : null;
  if (pay) assertCan(actor.perms, "deposit.manage");
  if (checkout.pickupNow) assertCan(actor.perms, "order.edit");

  // Khách lẻ: khách chung KHL không thuộc "khách của mình" của ai ⇒ chỉ trong phạm vi đơn này cho phép nhìn thấy nó
  let eff = actor;
  let order = input;
  if (checkout.walkIn) {
    order = { ...input, partnerId: await ensureWalkInCustomer(prisma) };
    eff = { ...actor, perms: new Set([...actor.perms, "partner.view_all"]) };
  }
  const planned = await planLines(prisma, order, docTimestamp(order.date, now));
  const products = [...new Set(planned.flatMap((l) => l.issues.map((i) => i.productId)))].sort((a, b) => a - b);
  const extra = checkout.walkIn ? { walkInName: checkout.walkIn.name || null, walkInPhone: checkout.walkIn.phone || null } : undefined;

  let createdId = 0;
  // Cờ treo (thiếu tồn) chỉ có SAU flush của engine ⇒ kiểm ở finalize (vẫn trong giao dịch: ném lỗi = huỷ cả đơn/phiếu thu/phiếu giao)
  const finalize = async (ctx: { tx: Prisma.TransactionClient }) => {
    if (checkout.pickupNow && createdId && (await ctx.tx.saleOrderLine.count({ where: { orderId: createdId, isProvisional: true } })) > 0) {
      throw new DomainError("Không đủ tồn để giao ngay cho khách. Hãy lập đơn thường (đơn treo) hoặc nhập bổ sung hàng.", 409);
    }
  };
  return withIdempotentInventoryTx(prisma, { userId: actor.userId, products, scope: "sale.checkout", key, finalize }, async (ctx) => {
    const tx = ctx.tx;
    const created = await createSaleOrder(ctx, eff, order, now, extra);
    createdId = created.id;
    const row = await tx.saleOrder.findUniqueOrThrow({ where: { id: created.id }, include: { lines: { orderBy: { id: "asc" } } } });
    const total = row.lines.reduce((s, l) => s.plus(lineAmountOf(l)), D(0)).plus(row.shippingFee);

    if (pay) {
      if (D(pay.amount).gt(total)) throw new DomainError("Số tiền thu vượt tiền phải thu của đơn.", 400);
      if (!pay.cashAccountId) throw new DomainError("Chọn quỹ/tài khoản nhận tiền.", 400);
    }
    if (checkout.walkIn && D(pay?.amount ?? 0).lt(total)) throw new DomainError("Khách lẻ phải thanh toán đủ tiền phải thu (không ghi nợ).", 400);

    if (pay) await createDeposit(tx, eff, { orderId: created.id, amount: pay.amount, cashAccountId: pay.cashAccountId!, date: order.date, note: pay.note }, now);
    if (checkout.pickupNow) {
      await createDeliveryNoteCore(tx, eff, { orderId: created.id, date: order.date, note: "Giao tại quầy", lines: row.lines.map((l) => ({ orderLineId: l.id, qty: Number(l.qty) })) }, now);
    }
    return created;
  });
}
