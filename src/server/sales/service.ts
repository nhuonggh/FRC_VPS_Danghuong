import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan, can } from "@/lib/permissions/guard";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { withIdempotentInventoryTx } from "@/server/idempotency/with-inventory-tx";
import { docTimestamp, postIssue, type EngineCtx } from "@/server/inventory";
import { getOpenPeriod } from "@/server/period/guard";
import { formatDocCode, nextDocId } from "@/server/purchase/codes";
import { convertToBase, resolveFactor } from "@/server/products/units";
import { planBomIssues } from "./issue-by-bom";
import { lastSalePricePerBase, priceForUnit } from "./pricing";
import type { SaleOrderInput } from "./schemas";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const dateOnly = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const sortedUnique = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);

/** Một mã hàng thực sự bị xuất kho cho một dòng bán. */
export interface PlannedIssue { productId: number; qtyBase: Prisma.Decimal }
export interface PlannedLine {
  index: number;
  input: SaleOrderInput["lines"][number];
  productCode: string;
  factor: Prisma.Decimal;
  qtyBase: Prisma.Decimal;
  issues: PlannedIssue[];
  bomVersionId: number | null;
}

/** Lập đơn cần đủ hai quyền: tạo đơn và xem giá bán (giá gợi ý và thành tiền luôn được tính). */
export function assertWriter(actor: Actor, permission: "order.create" | "order.edit") {
  assertCan(actor.perms, permission);
  assertCan(actor.perms, "sale_price.view");
}

/**
 * Dựng kế hoạch xuất kho cho từng dòng: dòng thường xuất chính mã bán; dòng có kiểu gia công xuất từng NVL theo BOM
 * hiệu lực tại thời điểm đơn (D-20) và giữ `bomVersionId` làm snapshot. Chạy được cả ngoài transaction (để biết trước
 * danh sách mã cần khoá) lẫn trong transaction (kiểm lại).
 */
export interface PlanOptions {
  /** Mã đang có trong đơn được phép giữ dù đã ngừng bán (khi sửa đơn cũ). */
  keepInactive?: ReadonlySet<number>;
  /** id dòng hiện có → phiên bản BOM đã dùng: dòng không đổi mã/kiểu gia công GIỮ định mức cũ (đơn cũ không đổi khi BOM đổi). */
  pinned?: ReadonlyMap<number, { productId: number; processingTypeId: number | null; bomVersionId: number | null }>;
}

export async function planLines(db: Db, input: SaleOrderInput, at: Date, opts: PlanOptions = {}): Promise<PlannedLine[]> {
  const keepInactive = opts.keepInactive ?? new Set<number>();
  const ids = sortedUnique(input.lines.map((l) => l.productId));
  const products = await db.product.findMany({ where: { id: { in: ids } }, include: { units: true } });
  const byId = new Map(products.map((p) => [p.id, p]));
  const out: PlannedLine[] = [];
  for (const [index, line] of input.lines.entries()) {
    const n = index + 1;
    const product = byId.get(line.productId);
    if (!product) throw new DomainError(`Dòng ${n}: sản phẩm không tồn tại.`, 400);
    if (!product.isActive && !keepInactive.has(product.id)) throw new DomainError(`Dòng ${n}: sản phẩm ${product.code} đã ngừng bán.`, 400);
    const factor = resolveFactor(product, line.unit);
    const qtyBase = convertToBase(line.qty, factor);
    if (!qtyBase.gt(0)) throw new DomainError(`Dòng ${n}: số lượng quá nhỏ (quy đổi ra ${product.baseUnit} bằng 0).`, 400);

    if (line.processingTypeId === null) {
      out.push({ index, input: line, productCode: product.code, factor, qtyBase, issues: [{ productId: product.id, qtyBase }], bomVersionId: null });
      continue;
    }
    const pin = line.id === undefined ? undefined : opts.pinned?.get(line.id);
    const pinnedVersionId = pin && pin.productId === product.id && pin.processingTypeId === line.processingTypeId ? pin.bomVersionId : null;
    const plan = await planBomIssues(db, { n, product, processingTypeId: line.processingTypeId, qtyBase, at, pinnedVersionId });
    out.push({ index, input: line, productCode: product.code, factor, qtyBase, issues: plan.issues, bomVersionId: plan.bomVersionId });
  }
  return out;
}

export async function loadCustomer(tx: Db, actor: Actor, partnerId: number) {
  // Ngoài phạm vi "khách của mình" trả cùng lỗi như không tồn tại (không lộ sự tồn tại của khách khác)
  const partner = await tx.partner.findFirst({ where: { id: partnerId, ...partnerScopeWhere(actor) }, select: { id: true, code: true, isCustomer: true, isActive: true, mergedIntoId: true } });
  if (!partner) throw new DomainError("Không tìm thấy khách hàng.", 404);
  if (!partner.isCustomer || !partner.isActive || partner.mergedIntoId !== null) throw new DomainError("Khách hàng không hợp lệ.", 400);
  return partner;
}

/** Không có quyền sửa giá tay → giá phải đúng bằng giá bán gần nhất (khách này, hoặc bất kỳ khách). Kiểm ở SERVER. */
export async function assertPrices(tx: Db, actor: Actor, partnerId: number, lines: PlannedLine[], unchanged: (l: PlannedLine) => boolean = () => false) {
  if (can(actor.perms, "order.edit_price")) return;
  for (const l of lines) {
    if (unchanged(l)) continue; // dòng giữ nguyên mã/đơn vị/giá của đơn cũ không bị coi là "sửa giá"
    const last = await lastSalePricePerBase(tx, l.input.productId, partnerId);
    if (!last) throw new DomainError(`Dòng ${l.index + 1}: ${l.productCode} chưa có giá bán tham chiếu — cần người có quyền sửa giá nhập giá lần đầu.`, 403);
    const expected = priceForUnit(last.perBase, l.factor);
    if (!D(l.input.salePrice).eq(expected)) {
      throw new DomainError(`Dòng ${l.index + 1}: bạn không có quyền sửa giá bán (giá gần nhất: ${expected.toString()}).`, 403);
    }
  }
}

/**
 * Người bán / kho xuất / hình thức thanh toán. Tạo mới: người bán mặc định = người lập, thanh toán NONE.
 * Sửa: trường bỏ trống (undefined) = giữ nguyên, null = xoá. Người bán phải đang hoạt động, kho phải đang dùng.
 */
export async function orderExtras(tx: Db, actor: Actor, input: SaleOrderInput, mode: "create" | "edit") {
  const out: { salesUserId?: number | null; warehouseId?: number | null; paymentMethod?: NonNullable<SaleOrderInput["paymentMethod"]> } = {};
  const salesUserId = input.salesUserId === undefined && mode === "create" ? actor.userId : input.salesUserId;
  if (salesUserId !== undefined) {
    if (salesUserId !== null && !(await tx.user.findFirst({ where: { id: salesUserId, isLocked: false }, select: { id: true } }))) throw new DomainError("Nhân viên bán không hợp lệ.", 400);
    out.salesUserId = salesUserId;
  }
  if (input.warehouseId !== undefined) {
    if (input.warehouseId !== null && !(await tx.warehouse.findFirst({ where: { id: input.warehouseId, isActive: true }, select: { id: true } }))) throw new DomainError("Kho xuất không hợp lệ.", 400);
    out.warehouseId = input.warehouseId;
  }
  if (input.paymentMethod !== undefined) out.paymentMethod = input.paymentMethod;
  return out;
}

/**
 * Lưu NHÁP một đơn đang lập: chưa xuất kho, chưa chiết khấu tích lũy, chưa công nợ (như đơn nháp từ báo giá).
 * Xác nhận sau bằng `confirmDraftOrderTx` (xuất kho FIFO lúc đó). Ngày đơn chốt lại lúc xác nhận.
 */
export async function createDraftSaleOrder(tx: Prisma.TransactionClient, actor: Actor, input: SaleOrderInput, now: Date = new Date()): Promise<{ id: number; code: string }> {
  assertWriter(actor, "order.create");
  if (input.lines.some((l) => l.id !== undefined)) throw new DomainError("Đơn mới không được kèm id dòng.", 400);
  const partner = await loadCustomer(tx, actor, input.partnerId);
  const at = docTimestamp(input.date, now);
  const lines = await planLines(tx, input, at);
  await assertPrices(tx, actor, input.partnerId, lines);
  const period = await getOpenPeriod(tx);
  const extras = await orderExtras(tx, actor, input, "create");
  const id = await nextDocId(tx, "sale_orders");
  const code = formatDocCode("DH", id);
  await tx.saleOrder.create({
    data: {
      id, code, periodId: period.id, partnerId: input.partnerId, orderDate: at, isDraft: true,
      expectedDeliveryDate: dateOnly(input.expectedDeliveryDate), originalDeliveryDate: dateOnly(input.expectedDeliveryDate),
      note: input.note || null, createdBy: actor.userId, ...extras,
      lines: {
        create: lines.map((l) => ({
          productId: l.input.productId, qty: D(l.input.qty), unit: l.input.unit, factorUsed: l.factor, qtyBase: l.qtyBase, salePrice: D(l.input.salePrice),
          discountNow: D(l.input.discountNow), discountAccum: D(l.input.discountAccum), processingTypeId: l.input.processingTypeId, at,
        })),
      },
    },
  });
  await writeAudit(tx, { userId: actor.userId, action: "sale.create_draft", entity: "SaleOrder", entityId: id, after: { code, partnerCode: partner.code, lineCount: lines.length } });
  return { id, code };
}

export async function createDraftSaleOrderIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: SaleOrderInput, now: Date = new Date()) {
  assertWriter(actor, "order.create");
  return withIdempotency(prisma, { userId: actor.userId, scope: "sale.create_draft", key }, (tx) => createDraftSaleOrder(tx, actor, input, now));
}

export async function createSaleOrder(ctx: EngineCtx, actor: Actor, input: SaleOrderInput, now: Date = new Date()): Promise<{ id: number; code: string }> {
  assertWriter(actor, "order.create");
  if (input.lines.some((l) => l.id !== undefined)) throw new DomainError("Đơn mới không được kèm id dòng.", 400);
  const tx = ctx.tx;
  const partner = await loadCustomer(tx, actor, input.partnerId);
  const at = docTimestamp(input.date, now);
  const lines = await planLines(tx, input, at);
  // Mã cần xuất phải nằm trong danh sách đã khoá (BOM có thể vừa đổi giữa lúc lập kế hoạch và lúc vào giao dịch)
  for (const l of lines) for (const i of l.issues) {
    if (!ctx.locked.has(i.productId)) throw new DomainError("Định mức hoặc dữ liệu vừa thay đổi, hãy tải lại trang rồi thử lại.", 409);
  }
  await assertPrices(tx, actor, input.partnerId, lines);

  const extras = await orderExtras(tx, actor, input, "create");
  const id = await nextDocId(tx, "sale_orders");
  const code = formatDocCode("DH", id);
  await tx.saleOrder.create({
    data: {
      id, code, periodId: ctx.period.id, partnerId: input.partnerId, orderDate: at,
      expectedDeliveryDate: dateOnly(input.expectedDeliveryDate), originalDeliveryDate: dateOnly(input.expectedDeliveryDate),
      note: input.note || null, createdBy: actor.userId, ...extras,
    },
  });
  for (const l of lines) {
    const row = await tx.saleOrderLine.create({
      data: {
        orderId: id, productId: l.input.productId, qty: D(l.input.qty), unit: l.input.unit, factorUsed: l.factor, qtyBase: l.qtyBase,
        salePrice: D(l.input.salePrice), discountNow: D(l.input.discountNow), discountAccum: D(l.input.discountAccum),
        processingTypeId: l.input.processingTypeId, bomVersionId: l.bomVersionId, at,
      },
    });
    for (const issue of l.issues) {
      const { seq } = await postIssue(ctx, { productId: issue.productId, qty: issue.qtyBase, docType: "SALE", docId: id, docLineId: row.id, at });
      await tx.saleLineIssue.create({ data: { orderLineId: row.id, productId: issue.productId, qtyBase: issue.qtyBase, seq } });
    }
    if (l.input.discountAccum > 0) {
      await tx.discountLedger.create({
        data: { periodId: ctx.period.id, partnerId: input.partnerId, orderLineId: row.id, amountIn: D(l.input.discountAccum), docType: "SALE", docId: id, at, createdBy: actor.userId },
      });
    }
  }
  // Audit KHÔNG chứa giá bán/giá vốn/chiết khấu (đường đọc audit vẫn redaction, nhưng không ghi thứ không cần)
  await writeAudit(tx, { userId: actor.userId, action: "sale.create", entity: "SaleOrder", entityId: id, after: { code, partnerCode: partner.code, lineCount: lines.length } });
  return { id, code };
}

export async function createSaleOrderIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: SaleOrderInput, now: Date = new Date()) {
  assertWriter(actor, "order.create");
  const planned = await planLines(prisma, input, docTimestamp(input.date, now));
  const products = sortedUnique(planned.flatMap((l) => l.issues.map((i) => i.productId)));
  return withIdempotentInventoryTx(prisma, { userId: actor.userId, products, scope: "sale.create", key }, (ctx) => createSaleOrder(ctx, actor, input, now));
}
