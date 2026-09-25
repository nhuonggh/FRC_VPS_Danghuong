import { Prisma, type PrismaClient, type StockDocType } from "@prisma/client";
import { DependentDocumentsError, InvalidCostError, InvalidQuantityError, PeriodClosedError, ProductRecomputingError } from "./errors";
import { assertDocDateInPeriod } from "@/server/period/guard";
import { restoreLayerRemaining } from "./layers";
import { assertLocked } from "./lock";
import { markDirty } from "./unit-of-work";
import type { DecInput, EngineCtx, InDocType, OutDocType, Tx } from "./types";

const D = (v: DecInput) => new Prisma.Decimal(v);

function requirePositive(qty: DecInput): Prisma.Decimal {
  const q = D(qty);
  if (!q.gt(0)) throw new InvalidQuantityError();
  return q;
}
function requireNonNegativeCost(cost: DecInput): Prisma.Decimal {
  const c = D(cost).toDecimalPlaces(4); // giá vốn đơn vị luôn (18,4)
  if (c.lt(0)) throw new InvalidCostError();
  return c;
}

export interface ReceiptInput {
  productId: number;
  qty: DecInput;
  unitCost: DecInput;
  docType: InDocType;
  docId: number;
  docLineId: number;
  /**
   * Thời điểm ghi sổ (D-7). Chứng từ mới/đổi ngày: lấy từ `docTimestamp`. Sửa chứng từ mà NGÀY KHÔNG ĐỔI:
   * người gọi PHẢI truyền lại `at` đã lưu (đọc trước khi `removeDocument`), KHÔNG gọi lại `docTimestamp`
   * (không ổn định qua các ngày — xem JSDoc của nó), nếu không thứ tự FIFO bị xê dịch.
   */
  at: Date;
  /** Lớp có giá vốn PHỤ THUỘC dòng khác: trả hàng (dòng bán gốc), thành phẩm SX (lệnh SX). */
  costRef?: { docType: StockDocType; docLineId: number; qty: DecInput };
}

/** Nhập kho: tạo 1 dòng sổ + 1 lớp lô. Chưa tính lại chuỗi — việc đó do flush() làm trước khi commit. */
export async function postReceipt(ctx: EngineCtx, i: ReceiptInput): Promise<{ ledgerId: number; layerId: number }> {
  assertLocked(ctx, i.productId);
  const qty = requirePositive(i.qty);
  const unitCost = requireNonNegativeCost(i.unitCost);
  assertDocDateInPeriod(ctx.period, i.at);

  const ledger = await ctx.tx.stockLedger.create({
    data: {
      periodId: ctx.period.id, productId: i.productId, docType: i.docType, docId: i.docId, docLineId: i.docLineId,
      qtyIn: qty, qtyOut: 0, unitCostOut: 0, qtyProvisional: 0, at: i.at, createdBy: ctx.userId,
    },
  });
  const layer = await ctx.tx.costLayer.create({
    data: {
      periodId: ctx.period.id, productId: i.productId, sourceDocType: i.docType, sourceDocId: i.docId, sourceLineId: i.docLineId,
      ledgerId: ledger.id, qtyIn: qty, qtyRemaining: qty, unitCost, at: i.at,
      costRefType: i.costRef?.docType ?? null, costRefId: i.costRef?.docLineId ?? null, costRefQty: i.costRef ? D(i.costRef.qty) : null,
    },
  });
  markDirty(ctx, i.productId, i.at);
  return { ledgerId: ledger.id, layerId: layer.id };
}

export interface IssueInput {
  productId: number;
  qty: DecInput;
  docType: OutDocType;
  docId: number;
  docLineId: number;
  /** Như `ReceiptInput.at`: sửa chứng từ cùng ngày → truyền lại `at` đã lưu, đừng gọi lại `docTimestamp`. */
  at: Date;
}

/** Xuất kho: ghi 1 dòng xuất. Giá vốn (FIFO) và phần thiếu hàng do flush() tính. */
export async function postIssue(ctx: EngineCtx, i: IssueInput): Promise<{ ledgerId: number }> {
  assertLocked(ctx, i.productId);
  const qty = requirePositive(i.qty);
  assertDocDateInPeriod(ctx.period, i.at);
  if (ctx.mode === "inline") {
    const p = await ctx.tx.product.findUniqueOrThrow({ where: { id: i.productId }, select: { recomputing: true } });
    if (p.recomputing) throw new ProductRecomputingError();
  }
  const ledger = await ctx.tx.stockLedger.create({
    data: {
      periodId: ctx.period.id, productId: i.productId, docType: i.docType, docId: i.docId, docLineId: i.docLineId,
      qtyIn: 0, qtyOut: qty, unitCostOut: 0, qtyProvisional: 0, at: i.at, createdBy: ctx.userId,
    },
  });
  markDirty(ctx, i.productId, i.at);
  return { ledgerId: ledger.id };
}

/** Các mã hàng của 1 chứng từ (dùng để khai báo `products` trước khi sửa/hủy). */
export async function productsOfDocument(db: Tx | PrismaClient, docType: StockDocType, docId: number): Promise<number[]> {
  const rows = await db.stockLedger.findMany({ where: { docType, docId }, distinct: ["productId"], select: { productId: true } });
  return rows.map((r) => r.productId).sort((a, b) => a - b);
}

/**
 * Hủy/sửa chứng từ: xoá dòng sổ, lớp và consumption của nó rồi đánh dấu tính lại từ điểm sớm nhất bị ảnh hưởng.
 * Sửa = removeDocument + đăng lại (cùng `at`). Khôi phục đơn đã hủy = đăng lại tại `at` gốc.
 */
export async function removeDocument(ctx: EngineCtx, docType: StockDocType, docId: number): Promise<{ removed: number }> {
  const rows = await ctx.tx.stockLedger.findMany({ where: { docType, docId } });
  if (rows.length === 0) return { removed: 0 };

  if (rows.some((r) => r.periodId !== ctx.period.id)) throw new PeriodClosedError();
  for (const r of rows) assertLocked(ctx, r.productId);

  const inRows = rows.filter((r) => r.qtyIn.gt(0));
  const outRows = rows.filter((r) => r.qtyOut.gt(0));
  const lineIds = outRows.map((r) => r.docLineId);

  // Không cho xoá khi còn lớp (trả hàng / thành phẩm) đang dựa vào giá vốn của các dòng này
  if (lineIds.length && (await ctx.tx.costLayer.count({ where: { costRefType: docType, costRefId: { in: lineIds }, periodId: ctx.period.id } })) > 0) {
    throw new DependentDocumentsError();
  }

  const layers = inRows.length ? await ctx.tx.costLayer.findMany({ where: { ledgerId: { in: inRows.map((r) => r.id) } } }) : [];
  const layerIds = layers.map((l) => l.id);
  const outIds = outRows.map((r) => r.id);
  // Lớp mà các dòng xuất bị xoá đã ăn: phải TRẢ LẠI số lượng (trừ khi chính lớp đó cũng bị xoá)
  const freed = outIds.length
    ? await ctx.tx.costConsumption.findMany({ where: { ledgerId: { in: outIds } }, select: { layerId: true } })
    : [];

  // Mốc tính lại theo từng mã: sớm nhất giữa dòng bị xoá và các dòng xuất KHÁC đã ăn lớp bị xoá
  const from = new Map<number, Date>();
  const touch = (productId: number, at: Date) => { const c = from.get(productId); if (!c || at < c) from.set(productId, at); };
  for (const r of rows) touch(r.productId, r.at);
  if (layerIds.length) {
    const eaters = await ctx.tx.costConsumption.findMany({ where: { layerId: { in: layerIds } }, select: { ledger: { select: { productId: true, at: true } } } });
    for (const e of eaters) touch(e.ledger.productId, e.ledger.at);
  }

  await ctx.tx.costConsumption.deleteMany({ where: { OR: [{ ledgerId: { in: outIds } }, { layerId: { in: layerIds } }] } });
  await restoreLayerRemaining(ctx.tx, freed.map((f) => f.layerId).filter((id) => !layerIds.includes(id)));
  if (layerIds.length) await ctx.tx.costLayer.deleteMany({ where: { id: { in: layerIds } } });
  await ctx.tx.stockLedger.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });

  for (const [productId, at] of from) markDirty(ctx, productId, at);
  return { removed: rows.length };
}

/** Đổi giá vốn lớp của chứng từ nguồn (vd cước vận chuyển nhập SAU phiếu hàng) → tính lại chuỗi từ lớp đó. */
export async function updateLayerCost(
  ctx: EngineCtx,
  i: { docType: StockDocType; docId: number; docLineId?: number; unitCost: DecInput },
): Promise<{ updated: number }> {
  const unitCost = requireNonNegativeCost(i.unitCost);
  const layers = await ctx.tx.costLayer.findMany({
    where: { sourceDocType: i.docType, sourceDocId: i.docId, ...(i.docLineId === undefined ? {} : { sourceLineId: i.docLineId }) },
  });
  // Chứng từ thuộc kỳ đã kết sổ: báo lỗi rõ ràng, không lẳng lặng bỏ qua (spec 4.4)
  if (layers.some((l) => l.periodId !== ctx.period.id)) throw new PeriodClosedError();
  for (const l of layers) {
    assertLocked(ctx, l.productId);
    await ctx.tx.costLayer.update({ where: { id: l.id }, data: { unitCost } });
    markDirty(ctx, l.productId, l.at);
  }
  return { updated: layers.length };
}
