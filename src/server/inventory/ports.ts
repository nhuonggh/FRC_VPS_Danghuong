import { Prisma, type PrismaClient, type StockDocType } from "@prisma/client";
import {
  DependentDocumentsError, DerivedLayerCostError, EngineInvariantError, InvalidCostError, InvalidCostRefError, InvalidCostRefTypeError, InvalidQuantityError,
  PeriodClosedError, ProductRecomputingError,
} from "./errors";
import { assertDocDateInPeriod } from "@/server/period/guard";
import { assertDerivedAfterSource, restoreLayerRemaining } from "./layers";
import { assertLocked } from "./lock";
import { lineSnapshot } from "./owners";
import { unitCostOf } from "./replay";
import { markDirty } from "./unit-of-work";
import { OUT_DOC_TYPES, type DecInput, type EngineCtx, type InDocType, type OutDocType, type Tx } from "./types";

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

const seqKeyOf = (docType: StockDocType, docId: number, docLineId: number, productId: number) =>
  `${docType}:${docId}:${docLineId}:${productId}`;

/**
 * Chọn `seq` (khoá thứ tự ghi ổn định — xem replay.ts `order`) cho dòng sổ sắp ghi:
 *  - `explicit` (module truyền seq đã lưu cùng dòng chứng từ — khôi phục qua giao dịch khác) → dùng nó; seq đang có
 *    dòng dùng, hoặc CHƯA TỪNG được sequence cấp (> giá trị lớn nhất đã cấp, hay < 1) ⇒ EngineInvariantError;
 *  - không truyền nhưng CÙNG giao dịch vừa removeDocument dòng cùng khoá (docType, docId, docLineId, productId)
 *    ⇒ tự dùng lại seq cũ (sửa = xoá + ghi lại giữ nguyên vị trí FIFO, người gọi không phải làm gì); seq đó đã bị lời
 *    gọi khác trong giao dịch chiếm (truyền tường minh) ⇒ EngineInvariantError;
 *  - còn lại ⇒ undefined: DB tự cấp seq mới (xếp SAU mọi dòng đã có).
 */
async function resolveSeq(ctx: EngineCtx, key: string, explicit: bigint | undefined): Promise<SeqChoice> {
  const pool = ctx.removedSeqs.get(key);
  if (explicit !== undefined) {
    // seq chưa từng được cấp: ghi vào sẽ "chiếm trước" giá trị mà sequence cấp sau này → lỗi UNIQUE (P2002) ở một
    // giao dịch KHÁC, vô can. Chỉ nhận seq đã lưu từ dòng sổ trước đó (≤ giá trị lớn nhất sequence đã cấp).
    const [s] = await ctx.tx.$queryRaw<{ last_value: bigint; is_called: boolean }[]>`SELECT last_value, is_called FROM "stock_ledger_seq_seq"`;
    const lastIssued = s!.is_called ? BigInt(s!.last_value) : BigInt(s!.last_value) - BigInt(1);
    if (explicit < BigInt(1) || explicit > lastIssued) {
      throw new EngineInvariantError(
        `Số thứ tự ghi sổ (seq) ${explicit} chưa từng được cấp (seq lớn nhất đã cấp: ${lastIssued}) — chỉ truyền lại seq đã lưu từ dòng sổ trước đó.`,
      );
    }
    await assertSeqFree(ctx, explicit);
    return {
      seq: explicit,
      commit: () => {
        const i = pool ? pool.indexOf(explicit) : -1;
        if (pool && i >= 0) pool.splice(i, 1);
      },
    };
  }
  const reuse = pool?.[0];
  if (reuse === undefined) return { seq: undefined, commit: () => {} };
  // seq vừa gỡ có thể đã bị lời gọi khác trong CÙNG giao dịch dùng (truyền `seq` tường minh) → lỗi rõ ràng, không P2002
  await assertSeqFree(ctx, reuse);
  return { seq: reuse, commit: () => void pool!.shift() };
}

/**
 * seq đã chọn + `commit` rút nó khỏi `ctx.removedSeqs`. Người gọi chỉ `commit` SAU khi mọi kiểm tra đầu vào đã qua
 * (ngay trước khi ghi): lời gọi bị từ chối (vd DerivedLayerDateError bị bắt lại trong `work`) không làm mất seq cũ.
 */
interface SeqChoice { seq: bigint | undefined; commit: () => void }

async function assertSeqFree(ctx: EngineCtx, seq: bigint): Promise<void> {
  if (await ctx.tx.stockLedger.findUnique({ where: { seq }, select: { id: true } })) {
    throw new EngineInvariantError(`Số thứ tự ghi sổ (seq) ${seq} đã được dùng bởi dòng sổ khác — không ghi/khôi phục chứng từ với seq này.`);
  }
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
  /**
   * Lớp có giá vốn PHỤ THUỘC dòng khác: trả hàng (dòng bán gốc), thành phẩm SX (lệnh SX). Mọi mã hàng của dòng gốc
   * phải có trong `products` của withInventoryTx (ProductNotLockedError nếu thiếu). `docType` phải là chứng từ XUẤT
   * (InvalidCostRefTypeError). `at` KHÔNG được TRƯỚC dòng gốc (DerivedLayerDateError) và dòng gốc phải được GHI
   * TRƯỚC lớp này (DerivedLayerOrderError); cùng `at` thì lớp xếp theo thứ tự ghi cùng các lệnh xuất. Lớp này KHÔNG
   * nuốt đơn treo; chỉ là tồn cho lệnh xuất xếp SAU nó — xem replay.ts.
   */
  costRef?: { docType: StockDocType; docLineId: number; qty: DecInput; share?: DecInput };
  /**
   * Khoá thứ tự ghi ỔN ĐỊNH đã lưu cùng dòng chứng từ (như `at`) — truyền lại khi KHÔI PHỤC chứng từ ở giao dịch khác.
   * Bỏ trống: sửa trong cùng giao dịch (removeDocument rồi ghi lại) tự dùng lại seq cũ; chứng từ mới nhận seq mới.
   */
  seq?: bigint;
}

/**
 * Nhập kho: tạo 1 dòng sổ + 1 lớp lô. Chưa tính lại chuỗi — việc đó do flush() làm trước khi commit.
 * Trả `seq` đã gán — module PHẢI lưu cùng dòng chứng từ (như `at`) để khôi phục đúng vị trí.
 */
export async function postReceipt(ctx: EngineCtx, i: ReceiptInput): Promise<{ ledgerId: number; layerId: number; seq: bigint }> {
  assertLocked(ctx, i.productId);
  const qty = requirePositive(i.qty);
  let unitCost = requireNonNegativeCost(i.unitCost);
  // costRef.qty là mẫu số khi lan truyền giá vốn (flush/propagate) → phải > 0, không được lẳng lặng bỏ qua
  const costRefQty = i.costRef ? D(i.costRef.qty) : null;
  const costRefShare = D(i.costRef?.share ?? 1).toDecimalPlaces(12);
  if (!costRefShare.isFinite() || !costRefShare.gt(0) || costRefShare.gt(1)) throw new InvalidCostRefError();
  if (costRefQty && !costRefQty.gt(0)) throw new InvalidCostRefError();
  // Giá lớp phụ thuộc = giá XUẤT của dòng gốc (lineSnapshot chỉ cộng dòng xuất) → trỏ chứng từ nhập là sai, và sẽ
  // lẳng lặng giữ giá người gọi truyền
  if (i.costRef && !(OUT_DOC_TYPES as readonly StockDocType[]).includes(i.costRef.docType)) throw new InvalidCostRefTypeError();
  assertDocDateInPeriod(ctx.period, i.at);
  const choice = await resolveSeq(ctx, seqKeyOf(i.docType, i.docId, i.docLineId, i.productId), i.seq);
  const seq = choice.seq;
  if (i.costRef && costRefQty) {
    // Giá lớp phụ thuộc là HÀM của dòng gốc — đúng công thức propagate dùng. Nếu dòng gốc đã có dòng sổ, lấy
    // giá từ đó thay cho `unitCost` người gọi truyền: nếu không, giá lớp sẽ phụ thuộc LỊCH SỬ tính lại (chỉ được
    // sửa khi dòng gốc tình cờ bị chạm) → tính lại từ đầu ≠ tính lại từng phần. Dòng gốc chưa có dòng sổ (sẽ
    // đăng sau trong cùng giao dịch) → tạm dùng `unitCost`; flush lan truyền lại khi dòng gốc được tính.
    // Dòng gốc thuộc kỳ đã kết sổ (trả hàng đơn kỳ cũ — spec 4.4) cũng đi đường này.
    // Đọc giá dòng gốc ⇒ mọi mã hàng của dòng gốc phải đang được khoá (không đọc giá đang bị giao dịch khác tính lại)
    const refRows = await ctx.tx.stockLedger.findMany({
      where: { docType: i.costRef.docType, docLineId: i.costRef.docLineId, qtyOut: { gt: 0 } },
      select: { productId: true, at: true, seq: true },
    });
    for (const r of refRows) assertLocked(ctx, r.productId);
    // seq mới do DB cấp luôn lớn hơn mọi dòng gốc đã có; seq dùng lại / truyền vào thì phải kiểm
    assertDerivedAfterSource({ at: i.at, ...(seq === undefined ? {} : { seq }) }, refRows);
    if (refRows.length > 0) unitCost = unitCostOf((await lineSnapshot(ctx.tx, i.costRef.docType, i.costRef.docLineId)).totalCost, costRefQty, costRefShare);
  }
  choice.commit(); // mọi kiểm tra đã qua → mới rút seq dùng lại khỏi ctx

  const ledger = await ctx.tx.stockLedger.create({
    data: {
      periodId: ctx.period.id, productId: i.productId, docType: i.docType, docId: i.docId, docLineId: i.docLineId,
      qtyIn: qty, qtyOut: 0, unitCostOut: 0, qtyProvisional: 0, at: i.at, createdBy: ctx.userId,
      ...(seq === undefined ? {} : { seq }),
    },
  });
  const layer = await ctx.tx.costLayer.create({
    data: {
      periodId: ctx.period.id, productId: i.productId, sourceDocType: i.docType, sourceDocId: i.docId, sourceLineId: i.docLineId,
      ledgerId: ledger.id, qtyIn: qty, qtyRemaining: qty, unitCost, at: i.at,
      costRefType: i.costRef?.docType ?? null, costRefId: i.costRef?.docLineId ?? null, costRefQty, costRefShare,
    },
  });
  markDirty(ctx, i.productId, i.at);
  return { ledgerId: ledger.id, layerId: layer.id, seq: ledger.seq };
}

export interface IssueInput {
  productId: number;
  qty: DecInput;
  docType: OutDocType;
  docId: number;
  docLineId: number;
  /** Như `ReceiptInput.at`: sửa chứng từ cùng ngày → truyền lại `at` đã lưu, đừng gọi lại `docTimestamp`. */
  at: Date;
  /** Như `ReceiptInput.seq`. */
  seq?: bigint;
}

/** Xuất kho: ghi 1 dòng xuất. Giá vốn (FIFO) và phần thiếu hàng do flush() tính. Trả `seq` — lưu như `at`. */
export async function postIssue(ctx: EngineCtx, i: IssueInput): Promise<{ ledgerId: number; seq: bigint }> {
  assertLocked(ctx, i.productId);
  const qty = requirePositive(i.qty);
  assertDocDateInPeriod(ctx.period, i.at);
  if (ctx.mode === "inline") {
    const p = await ctx.tx.product.findUniqueOrThrow({ where: { id: i.productId }, select: { recomputing: true } });
    if (p.recomputing) throw new ProductRecomputingError();
  }
  const { seq, commit } = await resolveSeq(ctx, seqKeyOf(i.docType, i.docId, i.docLineId, i.productId), i.seq);
  commit();
  const ledger = await ctx.tx.stockLedger.create({
    data: {
      periodId: ctx.period.id, productId: i.productId, docType: i.docType, docId: i.docId, docLineId: i.docLineId,
      qtyIn: 0, qtyOut: qty, unitCostOut: 0, qtyProvisional: 0, at: i.at, createdBy: ctx.userId,
      ...(seq === undefined ? {} : { seq }),
    },
  });
  markDirty(ctx, i.productId, i.at);
  return { ledgerId: ledger.id, seq: ledger.seq };
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
export async function removeDocument(
  ctx: EngineCtx, docType: StockDocType, docId: number,
): Promise<{ removed: number; seqs: { docLineId: number; productId: number; seq: bigint }[] }> {
  const rows = await ctx.tx.stockLedger.findMany({ where: { docType, docId } });
  if (rows.length === 0) return { removed: 0, seqs: [] };

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

  // Ghi nhớ seq để ghi lại trong CÙNG giao dịch (sửa) tự giữ vị trí — xem resolveSeq
  for (const r of [...rows].sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0))) {
    const key = seqKeyOf(r.docType, r.docId, r.docLineId, r.productId);
    ctx.removedSeqs.set(key, [...(ctx.removedSeqs.get(key) ?? []), r.seq]);
  }
  for (const [productId, at] of from) markDirty(ctx, productId, at);
  return { removed: rows.length, seqs: rows.map((r) => ({ docLineId: r.docLineId, productId: r.productId, seq: r.seq })) };
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
  // Lớp phụ thuộc (trả hàng/thành phẩm): giá do flush lan truyền từ dòng gốc — sửa tay sẽ bị ghi đè/lệch chuỗi.
  // Kiểm TRƯỚC khi đổi bất kỳ lớp nào (cả lời gọi bị từ chối, không đổi dở dang).
  if (layers.some((l) => l.costRefType !== null)) throw new DerivedLayerCostError();
  for (const l of layers) {
    assertLocked(ctx, l.productId);
    await ctx.tx.costLayer.update({ where: { id: l.id }, data: { unitCost } });
    markDirty(ctx, l.productId, l.at);
  }
  return { updated: layers.length };
}
