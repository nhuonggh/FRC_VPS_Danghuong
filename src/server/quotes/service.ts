import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { ictYmd } from "@/lib/time";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { docTimestamp } from "@/server/inventory";
import { getOpenPeriod } from "@/server/period/guard";
import { convertToBase, resolveFactor } from "@/server/products/units";
import { formatDocCode, nextDocId } from "@/server/purchase/codes";
import { loadCustomer } from "@/server/sales/service";
import type { QuoteInput } from "./schemas";

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Báo giá cần đúng hai quyền: quản lý báo giá và xem giá bán (giá là nội dung của báo giá). */
function assertWriter(actor: Actor) {
  assertCan(actor.perms, "quote.manage");
  assertCan(actor.perms, "sale_price.view");
}

async function validateLines(tx: Tx, lines: QuoteInput["lines"]) {
  const products = await tx.product.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.productId))] } }, include: { units: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const typeIds = [...new Set(lines.flatMap((l) => (l.processingTypeId ? [l.processingTypeId] : [])))];
  const types = new Set((await tx.processingType.findMany({ where: { id: { in: typeIds } }, select: { id: true } })).map((t) => t.id));
  lines.forEach((l, i) => {
    if (l.processingTypeId && !types.has(l.processingTypeId)) throw new DomainError(`Dòng ${i + 1}: kiểu gia công không tồn tại.`, 400);
    const p = byId.get(l.productId);
    if (!p) throw new DomainError(`Dòng ${i + 1}: sản phẩm không tồn tại.`, 400);
    if (!p.isActive) throw new DomainError(`Dòng ${i + 1}: sản phẩm ${p.code} đã ngừng bán.`, 400);
    resolveFactor(p, l.unit);
  });
}

const lineRows = (lines: QuoteInput["lines"]) => lines.map((l) => ({ productId: l.productId, qty: D(l.qty), unit: l.unit, salePrice: D(l.salePrice), note: l.note || null, processingTypeId: l.processingTypeId ?? null }));

async function lockQuote(tx: Tx, actor: Actor, id: number) {
  await tx.$queryRaw`SELECT id FROM quotes WHERE id = ${id} FOR UPDATE`;
  const quote = await tx.quote.findFirst({ where: { id, partner: partnerScopeWhere(actor) }, include: { lines: { orderBy: { id: "asc" } } } });
  if (!quote) throw new DomainError("Không tìm thấy báo giá.", 404);
  return quote;
}

export async function createQuote(tx: Tx, actor: Actor, input: QuoteInput, now: Date = new Date()): Promise<{ id: number; code: string }> {
  assertWriter(actor);
  const partner = await loadCustomer(tx, actor, input.partnerId);
  await validateLines(tx, input.lines);
  const period = await getOpenPeriod(tx);
  const at = docTimestamp(input.date, now);
  const id = await nextDocId(tx, "quotes");
  const code = formatDocCode("BG", id);
  await tx.quote.create({ data: { id, code, periodId: period.id, partnerId: input.partnerId, at, note: input.note || null, createdBy: actor.userId, lines: { create: lineRows(input.lines) } } });
  await writeAudit(tx, { userId: actor.userId, action: "quote.create", entity: "Quote", entityId: id, after: { code, partnerCode: partner.code, lineCount: input.lines.length } });
  return { id, code };
}

export const createQuoteIdempotent = (prisma: PrismaClient, actor: Actor, key: string, input: QuoteInput) => {
  assertWriter(actor);
  return withIdempotency(prisma, { userId: actor.userId, scope: "quote.create", key }, (tx) => createQuote(tx, actor, input));
};

/** Sửa báo giá: chỉ khi còn DRAFT/SENT (đã chuyển đơn hoặc đã hủy thì bất biến). */
export async function updateQuote(tx: Tx, actor: Actor, id: number, input: QuoteInput, now: Date = new Date()): Promise<{ id: number }> {
  assertWriter(actor);
  const quote = await lockQuote(tx, actor, id);
  if (quote.status === "CONVERTED") throw new DomainError("Báo giá đã chuyển thành đơn, không sửa được.", 409);
  if (quote.status === "CANCELLED") throw new DomainError("Báo giá đã hủy, không sửa được.", 409);
  if (input.partnerId !== quote.partnerId) await loadCustomer(tx, actor, input.partnerId);
  await validateLines(tx, input.lines);
  const at = ictYmd(quote.at) === input.date ? quote.at : docTimestamp(input.date, now);
  await tx.quoteLine.deleteMany({ where: { quoteId: id } });
  await tx.quote.update({ where: { id }, data: { partnerId: input.partnerId, at, note: input.note || null, lines: { create: lineRows(input.lines) } } });
  await writeAudit(tx, { userId: actor.userId, action: "quote.update", entity: "Quote", entityId: id, before: { code: quote.code, lineCount: quote.lines.length }, after: { code: quote.code, lineCount: input.lines.length } });
  return { id };
}

/** DRAFT → SENT (đã gửi khách); DRAFT/SENT → CANCELLED. Không có đường quay lại. */
export async function setQuoteStatus(tx: Tx, actor: Actor, id: number, status: "SENT" | "CANCELLED"): Promise<void> {
  assertCan(actor.perms, "quote.manage");
  const quote = await lockQuote(tx, actor, id);
  if (quote.status === "CONVERTED" || quote.status === "CANCELLED") throw new DomainError("Báo giá đã chốt, không đổi trạng thái được.", 409);
  if (status === "SENT" && quote.status !== "DRAFT") throw new DomainError("Báo giá đã được đánh dấu là đã gửi.", 409);
  await tx.quote.update({ where: { id }, data: { status } });
  await writeAudit(tx, { userId: actor.userId, action: status === "SENT" ? "quote.send" : "quote.cancel", entity: "Quote", entityId: id, before: { status: quote.status }, after: { status } });
}

/**
 * "Chuyển thành đơn" (mục 35): sinh ĐƠN NHÁP copy dòng hàng và giá từ báo giá. Không đụng kho, không công nợ (D-25):
 * xuất kho FIFO chỉ xảy ra khi người bán XÁC NHẬN đơn nháp. Báo giá sang CONVERTED và trỏ tới đơn.
 */
export async function convertQuote(tx: Tx, actor: Actor, id: number, now: Date = new Date()): Promise<{ orderId: number; code: string }> {
  assertCan(actor.perms, "quote.manage");
  assertCan(actor.perms, "order.create");
  const quote = await lockQuote(tx, actor, id);
  if (quote.status === "CONVERTED") throw new DomainError("Báo giá đã chuyển thành đơn.", 409);
  if (quote.status === "CANCELLED") throw new DomainError("Báo giá đã hủy, không chuyển thành đơn được.", 409);
  await loadCustomer(tx, actor, quote.partnerId);
  const period = await getOpenPeriod(tx);
  const products = await tx.product.findMany({ where: { id: { in: quote.lines.map((l) => l.productId) } }, include: { units: true } });
  const byId = new Map(products.map((p) => [p.id, p]));

  const today = ictYmd(now);
  const dateOnly = new Date(`${today}T00:00:00Z`);
  const orderId = await nextDocId(tx, "sale_orders");
  const code = formatDocCode("DH", orderId);
  await tx.saleOrder.create({
    data: {
      id: orderId, code, periodId: period.id, partnerId: quote.partnerId, orderDate: now, isDraft: true,
      expectedDeliveryDate: dateOnly, originalDeliveryDate: dateOnly, note: quote.note, createdBy: actor.userId,
      lines: {
        create: quote.lines.map((l, i) => {
          const p = byId.get(l.productId);
          if (!p) throw new DomainError(`Dòng ${i + 1}: sản phẩm không tồn tại.`, 400);
          if (!p.isActive) throw new DomainError(`Dòng ${i + 1}: sản phẩm ${p.code} đã ngừng bán.`, 400);
          const factor = resolveFactor(p, l.unit);
          const qtyBase = convertToBase(l.qty, factor);
          if (!qtyBase.gt(0)) throw new DomainError(`Dòng ${i + 1}: số lượng quá nhỏ.`, 400);
          return { productId: l.productId, qty: l.qty, unit: l.unit, factorUsed: factor, qtyBase, salePrice: l.salePrice, at: now, processingTypeId: l.processingTypeId };
        }),
      },
    },
  });
  await tx.quote.update({ where: { id }, data: { status: "CONVERTED", convertedOrderId: orderId } });
  await writeAudit(tx, { userId: actor.userId, action: "quote.convert", entity: "Quote", entityId: id, after: { quoteCode: quote.code, orderCode: code } });
  return { orderId, code };
}
