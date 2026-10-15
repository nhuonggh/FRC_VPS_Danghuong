import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { ictStartOfDay, toIct } from "@/lib/time";
import { DomainError } from "@/server/http/errors";
import { EngineInvariantError, postOpeningLots } from "@/server/inventory";
import { getCloseChecklist } from "./close-checklist";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = D(0);

/** Số liệu "sẽ thành đầu kỳ mới" để người kết sổ xem trước (chỉ đọc — cùng hàm tính với lần kết thật). */
export interface ClosePreview {
  stock: { lots: number; products: number; qty: string; value: string };
  receivable: { partners: number; total: string };
  payable: { partners: number; total: string };
  cash: { accountId: number; balance: string }[];
  discount: { partners: number; total: string };
}

export async function previewClosing(db: PrismaClient, periodId: number): Promise<ClosePreview> {
  const c = await computeClosing(db, periodId);
  const sum = (vals: Prisma.Decimal[]) => vals.reduce((a, v) => a.plus(v), ZERO);
  const debts = [...c.debt.values()];
  return {
    stock: { lots: c.lots.length, products: new Set(c.lots.map((l) => l.productId)).size, qty: sum(c.lots.map((l) => l.qty)).toString(), value: sum(c.lots.map((l) => l.qty.times(l.unitCost))).toFixed(2) },
    receivable: { partners: debts.filter((v) => v.gt(0)).length, total: sum(debts.filter((v) => v.gt(0))).toFixed(2) },
    payable: { partners: debts.filter((v) => v.lt(0)).length, total: sum(debts.filter((v) => v.lt(0))).abs().toFixed(2) },
    cash: [...c.cash].map(([accountId, balance]) => ({ accountId, balance: balance.toFixed(2) })),
    discount: { partners: c.discount.size, total: sum([...c.discount.values()]).toFixed(2) },
  };
}

export interface CloseInfo { closed: { id: number; name: string }; newPeriod: { id: number; name: string }; carried: ClosePeriodResult["carried"]; warningCount: number }

export interface ClosePeriodInput {
  /** Chạy TRONG transaction, sau khi mọi kiểm tra đạt (engine kỳ không ghi audit — module gọi truyền vào, xem `closing/service.ts`). */
  afterClose?: (tx: Prisma.TransactionClient, info: CloseInfo) => Promise<void>;
  /** Tên kỳ mới; bỏ trống = "Kỳ MM/YYYY" theo giờ ICT lúc kết sổ. */
  newName?: string;
  now?: Date;
}

export interface ClosePeriodResult {
  closedPeriodId: number;
  newPeriod: { id: number; name: string; openedAt: Date };
  carried: { stockLots: number; stockProducts: number; stockQty: string; stockValue: string; debtPartners: number; cashAccounts: number; discountPartners: number; draftOrders: number; quotes: number };
}

export const defaultPeriodName = (now: Date): string => {
  const t = toIct(now);
  return `Kỳ ${String(t.m + 1).padStart(2, "0")}/${t.y}`;
};

type Lot = { id: number; productId: number; qty: Prisma.Decimal; unitCost: Prisma.Decimal };

/** Số dư ĐẦU KỲ MỚI sẽ có, tính từ sổ kỳ cũ — cùng công thức báo cáo: đầu kỳ + Σ(phát sinh). */
export interface Closing {
  lots: Lot[];
  debt: Map<number, Prisma.Decimal>;
  cash: Map<number, Prisma.Decimal>;
  discount: Map<number, Prisma.Decimal>;
}

const nonZero = (m: Map<number, Prisma.Decimal>) => new Map([...m].filter(([, v]) => !v.isZero()));
const add = (m: Map<number, Prisma.Decimal>, k: number, v: Prisma.Decimal.Value) => m.set(k, (m.get(k) ?? ZERO).plus(v));

export async function computeClosing(tx: Prisma.TransactionClient, periodId: number): Promise<Closing> {
  const [lots, openDebt, debtSums, openCash, cashSums, openDisc, discSums, provisional] = await Promise.all([
    tx.$queryRaw<{ id: number; productId: number; qty: Prisma.Decimal; unitCost: Prisma.Decimal }[]>`
      SELECT id, "productId", "qtyRemaining" AS qty, "unitCost" FROM cost_layers
       WHERE "periodId" = ${periodId} AND "qtyRemaining" > 0 ORDER BY "productId", at, id`,
    tx.openingDebt.findMany({ where: { periodId }, select: { partnerId: true, amount: true } }),
    tx.partnerLedger.groupBy({ by: ["partnerId"], where: { periodId }, _sum: { debit: true, credit: true } }),
    tx.openingCash.findMany({ where: { periodId }, select: { cashAccountId: true, amount: true } }),
    tx.cashLedger.groupBy({ by: ["cashAccountId"], where: { periodId }, _sum: { amountIn: true, amountOut: true } }),
    tx.openingDiscount.findMany({ where: { periodId }, select: { partnerId: true, amount: true } }),
    tx.discountLedger.groupBy({ by: ["partnerId"], where: { periodId }, _sum: { amountIn: true, amountOut: true } }),
    tx.stockLedger.count({ where: { periodId, qtyProvisional: { gt: 0 } } }),
  ]);
  if (provisional > 0) throw new EngineInvariantError(`Kỳ còn ${provisional} dòng xuất thiếu hàng (đơn treo) — không kết sổ được.`);
  const debt = new Map<number, Prisma.Decimal>(), cash = new Map<number, Prisma.Decimal>(), discount = new Map<number, Prisma.Decimal>();
  for (const r of openDebt) add(debt, r.partnerId, r.amount);
  for (const r of debtSums) add(debt, r.partnerId, D(r._sum.debit ?? 0).minus(r._sum.credit ?? 0));
  for (const r of openCash) add(cash, r.cashAccountId, r.amount);
  for (const r of cashSums) add(cash, r.cashAccountId, D(r._sum.amountIn ?? 0).minus(r._sum.amountOut ?? 0));
  for (const r of openDisc) add(discount, r.partnerId, r.amount);
  for (const r of discSums) add(discount, r.partnerId, D(r._sum.amountIn ?? 0).minus(r._sum.amountOut ?? 0));
  return { lots: lots.map((l) => ({ id: l.id, productId: l.productId, qty: D(l.qty), unitCost: D(l.unitCost) })), debt: nonZero(debt), cash: nonZero(cash), discount: nonZero(discount) };
}

const sameMap = (what: string, a: Map<number, Prisma.Decimal>, b: Map<number, Prisma.Decimal>) => {
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (!(a.get(key) ?? ZERO).equals(b.get(key) ?? ZERO)) {
      throw new EngineInvariantError(`Kiểm tra sau kết sổ thất bại: ${what} #${key} lệch (kỳ cũ ${(a.get(key) ?? ZERO).toString()} ≠ đầu kỳ mới ${(b.get(key) ?? ZERO).toString()}). Đã hoàn tác.`);
    }
  }
};

/** Đọc lại kỳ MỚI từ DB và so với số cuối kỳ cũ — lệch bất kỳ chỗ nào ⇒ throw ⇒ rollback cả kết sổ. */
async function verifyOpening(tx: Prisma.TransactionClient, newPeriodId: number, closing: Closing) {
  const [debt, cash, disc, layers] = await Promise.all([
    tx.openingDebt.findMany({ where: { periodId: newPeriodId }, select: { partnerId: true, amount: true } }),
    tx.openingCash.findMany({ where: { periodId: newPeriodId }, select: { cashAccountId: true, amount: true } }),
    tx.openingDiscount.findMany({ where: { periodId: newPeriodId }, select: { partnerId: true, amount: true } }),
    tx.$queryRaw<{ productId: number; qty: Prisma.Decimal; unitCost: Prisma.Decimal; qtyIn: Prisma.Decimal }[]>`
      SELECT "productId", "qtyRemaining" AS qty, "unitCost", "qtyIn" FROM cost_layers WHERE "periodId" = ${newPeriodId} ORDER BY "productId", at, id`,
  ]);
  sameMap("công nợ đối tác", closing.debt, new Map(debt.map((r) => [r.partnerId, D(r.amount)])));
  sameMap("quỹ", closing.cash, new Map(cash.map((r) => [r.cashAccountId, D(r.amount)])));
  sameMap("chiết khấu tích lũy", closing.discount, new Map(disc.map((r) => [r.partnerId, D(r.amount)])));
  // từng lô: cùng mã, cùng số lượng, cùng giá vốn, cùng thứ tự FIFO — không mã nào đổi giá vốn bình quân
  if (layers.length !== closing.lots.length) throw new EngineInvariantError(`Kiểm tra sau kết sổ thất bại: số lô ${closing.lots.length} → ${layers.length}. Đã hoàn tác.`);
  closing.lots.forEach((lot, i) => {
    const l = layers[i]!;
    if (l.productId !== lot.productId || !D(l.qty).equals(lot.qty) || !D(l.qtyIn).equals(lot.qty) || !D(l.unitCost).equals(lot.unitCost)) {
      throw new EngineInvariantError(`Kiểm tra sau kết sổ thất bại: lô thứ ${i + 1} của mã #${lot.productId} lệch số lượng/giá vốn. Đã hoàn tác.`);
    }
  });
}

/**
 * KẾT SỔ kỳ đang mở (Plan 07 F1b) — MỘT transaction, hoặc xong hết hoặc không gì cả:
 *  1. khoá `FOR UPDATE` dòng kỳ (bước ĐẦU TIÊN — mọi giao dịch kho giữ `FOR SHARE` nên tuần tự với kết sổ; hai người bấm
 *     cùng lúc ⇒ người sau thấy kỳ đã đóng);
 *  2. chạy lại checklist TRONG transaction: còn mục chặn ⇒ từ chối (không tin kết quả xem trước ở trang);
 *  3. tính số cuối kỳ từ sổ (tồn từng lô, công nợ từng đối tác, từng quỹ, chiết khấu tích lũy);
 *  4. đóng kỳ cũ, mở kỳ mới; ghi `opening_*` kỳ mới (CHUYỂN TIẾP, không về 0); lô tồn giữ NGUYÊN từng lô qua engine
 *     (`postOpeningLots`) — mặc định chờ khách xác nhận (plan 07, câu 1);
 *  5. mang đơn nháp + báo giá chưa chốt sang kỳ mới (đổi `periodId`; chứng từ đã ghi sổ ở lại kỳ cũ);
 *  6. đọc lại kỳ mới và so với số cuối kỳ cũ — lệch ⇒ throw ⇒ rollback;
 *  7. audit.
 * Giao dịch kho/sổ khác chờ khoá rồi thấy kỳ cũ đã đóng ⇒ PeriodClosedError; chứng từ mới đi vào kỳ mới.
 */
export async function closeOpenPeriod(prisma: PrismaClient, actor: Actor, input: ClosePeriodInput = {}): Promise<ClosePeriodResult> {
  assertCan(actor.perms, "period.close");
  const now = input.now ?? new Date();
  const newName = (input.newName ?? defaultPeriodName(now)).trim();
  if (!newName || newName.length > 60) throw new DomainError("Tên kỳ mới không hợp lệ (1–60 ký tự).", 400, "INVALID_PERIOD_NAME");

  return prisma.$transaction(
    async (tx) => {
      const [current] = await tx.$queryRaw<{ id: number; name: string }[]>`SELECT id, name FROM periods WHERE "isOpen" = true FOR UPDATE`;
      if (!current) throw new DomainError("Kỳ này đã được kết sổ (hoặc chưa có kỳ đang mở).", 409, "PERIOD_ALREADY_CLOSED");

      const checklist = await getCloseChecklist(tx);
      if (checklist.blockerCount > 0) {
        throw new DomainError(`Còn ${checklist.blockerCount} mục chặn kết sổ — xử lý hết ở trang Kết sổ cuối kỳ trước.`, 409, "CLOSE_BLOCKED");
      }

      const closing = await computeClosing(tx, current.id);

      await tx.period.update({ where: { id: current.id }, data: { status: "CLOSED", isOpen: null, closedAt: now, closedBy: actor.userId } });
      const next = await tx.period.create({ data: { name: newName, status: "OPEN", isOpen: true, openedAt: now } });

      const o = toIct(now);
      const at = ictStartOfDay(o.y, o.m, o.d); // cùng quy ước nhập số đầu kỳ tay (opening/stock.ts)

      if (closing.debt.size) await tx.openingDebt.createMany({ data: [...closing.debt].map(([partnerId, amount]) => ({ periodId: next.id, partnerId, amount })) });
      if (closing.cash.size) await tx.openingCash.createMany({ data: [...closing.cash].map(([cashAccountId, amount]) => ({ periodId: next.id, cashAccountId, amount })) });
      if (closing.discount.size) await tx.openingDiscount.createMany({ data: [...closing.discount].map(([partnerId, amount]) => ({ periodId: next.id, partnerId, amount })) });

      if (closing.lots.length) {
        const rows = await tx.openingStock.createManyAndReturn({
          data: closing.lots.map((l) => ({ periodId: next.id, productId: l.productId, qty: l.qty, unitCost: l.unitCost })),
          select: { id: true },
        });
        // createManyAndReturn giữ thứ tự đầu vào ⇒ ghép theo chỉ số
        await postOpeningLots(tx, {
          period: { id: next.id, openedAt: next.openedAt }, userId: actor.userId, at,
          lots: closing.lots.map((l, i) => ({ productId: l.productId, qty: l.qty, unitCost: l.unitCost, openingId: rows[i]!.id })),
        });
      }

      const [draftOrders, quotes] = await Promise.all([
        tx.saleOrder.updateMany({ where: { periodId: current.id, isDraft: true, isCancelled: false }, data: { periodId: next.id } }),
        tx.quote.updateMany({ where: { periodId: current.id, status: { in: ["DRAFT", "SENT"] } }, data: { periodId: next.id } }),
      ]);

      await verifyOpening(tx, next.id, closing);

      const stockQty = closing.lots.reduce((s, l) => s.plus(l.qty), ZERO), stockValue = closing.lots.reduce((s, l) => s.plus(l.qty.times(l.unitCost)), ZERO);
      const carried = {
        stockLots: closing.lots.length, stockProducts: new Set(closing.lots.map((l) => l.productId)).size, stockQty: stockQty.toString(), stockValue: stockValue.toFixed(2),
        debtPartners: closing.debt.size, cashAccounts: closing.cash.size, discountPartners: closing.discount.size, draftOrders: draftOrders.count, quotes: quotes.count,
      };
      await input.afterClose?.(tx, { closed: { id: current.id, name: current.name }, newPeriod: { id: next.id, name: next.name }, carried, warningCount: checklist.warningCount });
      return { closedPeriodId: current.id, newPeriod: { id: next.id, name: next.name, openedAt: next.openedAt }, carried };
    },
    { maxWait: 15_000, timeout: 300_000 },
  );
}
