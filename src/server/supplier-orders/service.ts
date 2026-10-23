import { lockIdsOf } from "@/server/stock-lanes";
import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { DomainError } from "@/server/http/errors";
import { writeAudit } from "@/server/audit/write";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { withIdempotentInventoryTx } from "@/server/idempotency/with-inventory-tx";
import { createPurchase } from "@/server/purchase/service";
import { convertToBase, resolveFactor } from "@/server/products/units";
import type { ReceiveOrderInput, SupplierOrderInput } from "./schemas";
import { orderActionSchema } from "./schemas";
import type { z } from "zod";

export const orderInclude = { partner: { select: { name: true } }, creator: { select: { fullName: true } }, lines: { orderBy: { id: "asc" as const }, include: { product: { select: { name: true, code: true } }, receipts: { include: { purchase: true }, orderBy: { id: "asc" as const } } } } } satisfies Prisma.SupplierOrderInclude;
export type OrderWithLines = Prisma.SupplierOrderGetPayload<{ include: typeof orderInclude }>;
export function receivedQty(line: OrderWithLines["lines"][number]) {
  return line.receipts.filter(r => !r.purchase.isCancelled).reduce((s, r) => s.plus(r.qty), new Prisma.Decimal(0));
}
export function progress(order: Pick<OrderWithLines, "state" | "lines">) {
  if (order.state !== "SENT") return order.state;
  if (order.lines.every(l => receivedQty(l).gte(l.qty))) return "RECEIVED";
  return order.lines.some(l => receivedQty(l).gt(0)) ? "PARTIAL" : "SENT";
}
function writer(actor: Actor, perm: "purchase.create" | "purchase.edit") { assertCan(actor.perms, perm); assertCan(actor.perms, "purchase_price.view"); }
async function lock(tx: Prisma.TransactionClient, id: number) {
  await tx.$queryRaw`SELECT id FROM supplier_orders WHERE id = ${id} FOR UPDATE`;
  const row = await tx.supplierOrder.findUnique({ where: { id }, include: orderInclude });
  if (!row) throw new DomainError("Không tìm thấy đơn đặt hàng.", 404);
  return row;
}
export async function createSupplierOrder(db: PrismaClient, actor: Actor, key: string, input: SupplierOrderInput) {
  writer(actor, "purchase.create");
  return withIdempotency(db, { userId: actor.userId, scope: "supplier-order.create", key }, async tx => {
    const partner = await tx.partner.findUnique({ where: { id: input.partnerId } });
    if (!partner?.isSupplier || !partner.isActive || partner.mergedIntoId) throw new DomainError("Nhà cung cấp không hợp lệ.", 400);
    const lines = [];
    for (const l of input.lines) {
      const product = await tx.product.findUnique({ where: { id: l.productId }, include: { units: true } });
      if (!product?.isActive || !product.canPurchase) throw new DomainError("Sản phẩm không được mua hoặc đã ngừng hoạt động.", 400);
      resolveFactor(product, l.unit);
      if (l.unit === product.baseUnit && l.factor !== 1) throw new DomainError("Đơn vị gốc phải có tỷ trọng 1.", 400);
      if (!convertToBase(l.qty, l.factor).gt(0)) throw new DomainError("Số lượng quy đổi quá nhỏ.", 400);
      if (l.processingTypeId && !await tx.processingType.findUnique({ where: { id: l.processingTypeId } })) throw new DomainError("Kiểu gia công không tồn tại.", 400);
      lines.push({ productId: l.productId, qty: l.qty, unit: l.unit, factor: l.factor, purchasePrice: l.purchasePrice, processingTypeId: l.processingTypeId ?? null, note: l.rollInfo, expectedDate: l.expectedDate ? new Date(l.expectedDate) : null });
    }
    const [seq] = await tx.$queryRaw<{ id: number }[]>`SELECT nextval(pg_get_serial_sequence('supplier_orders','id'))::int AS id`;
    const order = await tx.supplierOrder.create({ data: { id: seq.id, code: `DHNCC-${String(seq.id).padStart(6, "0")}`, partnerId: input.partnerId, date: new Date(input.date), note: input.note, attachments: input.attachments, createdBy: actor.userId, lines: { create: lines } } });
    await writeAudit(tx, { userId: actor.userId, action: "supplier-order.create", entity: "SupplierOrder", entityId: order.id, after: { ...input, attachments: input.attachments.map(a => a.name) } });
    return { id: order.id };
  });
}
export async function actOnOrder(db: PrismaClient, actor: Actor, id: number, input: z.infer<typeof orderActionSchema>) {
  writer(actor, "purchase.edit");
  return db.$transaction(async tx => {
    const order = await lock(tx, id), status = progress(order);
    if (["CANCELLED", "CLOSED", "RECEIVED"].includes(status)) throw new DomainError("Đơn đã kết thúc.", 409);
    if (input.action === "send" && order.state !== "DRAFT") throw new DomainError("Đơn đã gửi trước đó.", 409);
    if (input.action === "cancel" && order.lines.some(l => receivedQty(l).gt(0))) throw new DomainError("Đơn đã nhận hàng; hãy đóng phần còn thiếu.", 409);
    if (["cancel", "close"].includes(input.action) && !input.reason) throw new DomainError("Nhập lý do.", 400);
    if (input.action === "schedule") {
      for (const d of input.dates) {
        if (!order.lines.some(l => l.id === d.lineId)) throw new DomainError("Dòng không thuộc đơn.", 400);
        await tx.supplierOrderLine.update({ where: { id: d.lineId }, data: { expectedDate: d.expectedDate ? new Date(d.expectedDate) : null } });
      }
    } else await tx.supplierOrder.update({ where: { id }, data: { state: input.action === "send" ? "SENT" : input.action === "cancel" ? "CANCELLED" : "CLOSED", closeReason: input.reason || null } });
    await writeAudit(tx, { userId: actor.userId, action: `supplier-order.${input.action}`, entity: "SupplierOrder", entityId: id, after: input });
    return { id };
  });
}
export async function receiveSupplierOrder(db: PrismaClient, actor: Actor, id: number, key: string, input: ReceiveOrderInput) {
  writer(actor, "purchase.create");
  const seed = await db.supplierOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!seed) throw new DomainError("Không tìm thấy đơn.", 404);
  const selected = await db.supplierOrderLine.findMany({ where: { id: { in: input.lines.map(l => l.lineId) } } });
  const orderIds = [...new Set([id, ...selected.map(l => l.orderId)])].sort((a,b) => a-b);
  return withIdempotentInventoryTx(db, { userId: actor.userId, products: await lockIdsOf(db, [...seed.lines, ...selected]), scope: `supplier-order.receive:${id}`, key }, async ctx => {
    const orders: OrderWithLines[] = [];
    for (const orderId of orderIds) orders.push(await lock(ctx.tx, orderId));
    const order = orders.find(o => o.id === id)!;
    if (orders.some(o => o.partnerId !== order.partnerId)) throw new DomainError("Chỉ gộp nhận các đơn cùng nhà cung cấp.", 400);
    if (orders.some(o => o.state !== "SENT")) throw new DomainError("Chỉ nhận đơn đã gửi và chưa đóng/hủy.", 409);
    const lines = input.lines.map(l => {
      const source = orders.flatMap(o => o.lines).find(s => s.id === l.lineId);
      if (!source) throw new DomainError("Sản phẩm nhận không thuộc đơn đặt.", 400);
      if (receivedQty(source).plus(l.qty).gt(source.qty) && !input.excessReason) throw new DomainError("Nhận vượt số đặt. Xác nhận và nhập lý do nhận thừa.", 400);
      return { productId: source.productId, qty: l.qty, unit: source.unit, factor: Number(source.factor), purchasePrice: l.purchasePrice, rollInfo: source.note, processingTypeId: source.processingTypeId };
    });
    const purchase = await createPurchase(ctx, actor, { partnerId: order.partnerId, date: input.date, freightCost: input.freightCost, note: [orders.map(o => o.code).join(", "), input.note, input.excessReason && `Nhận thừa: ${input.excessReason}`].filter(Boolean).join(" — ").slice(0, 500), lines });
    const rows = await ctx.tx.purchaseLine.findMany({ where: { purchaseId: purchase.id }, orderBy: { id: "asc" } });
    for (const [i, row] of rows.entries()) await ctx.tx.purchaseLine.update({ where: { id: row.id }, data: { supplierOrderLineId: input.lines[i].lineId } });
    for (const touched of orders.filter(o => o.lines.some(l => input.lines.some(r => r.lineId === l.id)))) {
      const updated = await ctx.tx.supplierOrder.findUniqueOrThrow({ where: { id: touched.id }, include: orderInclude });
      await ctx.tx.supplierOrderNotice.create({ data: { userId: touched.createdBy, orderId: touched.id, purchaseId: purchase.id, message: `${touched.code}: ${progress(updated) === "RECEIVED" ? "đã nhận đủ" : "đã nhận một phần"} · phiếu ${purchase.code}` } });
      await writeAudit(ctx.tx, { userId: actor.userId, action: "supplier-order.receive", entity: "SupplierOrder", entityId: touched.id, after: { ...input, purchaseId: purchase.id } });
    }
    return purchase;
  });
}
