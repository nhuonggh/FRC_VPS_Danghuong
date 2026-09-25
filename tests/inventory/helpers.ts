import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, expect } from "vitest";
import { clearCostOwners, OWNER_REQUIRED_DOC_TYPES, registerCostOwner } from "@/server/inventory/owners";
import { postIssue, postReceipt } from "@/server/inventory/ports";
import type { EngineCtx } from "@/server/inventory/types";
import { withInventoryTx, type WithInventoryOptions } from "@/server/inventory/unit-of-work";
import { prisma } from "../helpers/db";
import { makePeriod, makeProduct, makeUser } from "../helpers/factories";

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Mốc thời gian dễ đọc: T(n) = n phút sau 01/09/2026 00:00Z. */
export const T = (minutes: number) => new Date(Date.UTC(2026, 8, 1, 0, 0) + minutes * 60_000);

export async function newWorld(productCount = 1) {
  const user = await makeUser();
  // Kỳ mở từ 01/08/2026 để các mốc T(n) (tháng 9) đều nằm trong kỳ
  const period = await makePeriod({ openedAt: new Date("2026-08-01T00:00:00Z") });
  const products = [];
  for (let i = 0; i < productCount; i++) products.push(await makeProduct());
  return { userId: user.id, periodId: period.id, period, products, p: products[0]! };
}
export type World = Awaited<ReturnType<typeof newWorld>>;

/**
 * Bất biến sổ kho — gọi sau MỌI thao tác trong test engine:
 *  (1) Σ qtyIn − Σ qtyOut = Σ layer.qtyRemaining − Σ qtyProvisional   (tồn tính từ sổ = tồn tính từ lớp)
 *  (2) mỗi lớp: qtyRemaining = qtyIn − Σ consumption của lớp đó
 *  (3) mỗi dòng xuất: Σ consumption + qtyProvisional = qtyOut
 */
export async function assertLedgerBalanced(productId: number, periodId: number): Promise<void> {
  const led = await prisma.stockLedger.aggregate({
    where: { productId, periodId },
    _sum: { qtyIn: true, qtyOut: true, qtyProvisional: true },
  });
  const lay = await prisma.costLayer.aggregate({ where: { productId, periodId }, _sum: { qtyRemaining: true } });
  const inn = D(led._sum.qtyIn ?? 0);
  const out = D(led._sum.qtyOut ?? 0);
  const prov = D(led._sum.qtyProvisional ?? 0);
  const rem = D(lay._sum.qtyRemaining ?? 0);
  expect(inn.minus(out).toString(), "Σin − Σout = Σremaining − Σprovisional").toBe(rem.minus(prov).toString());

  const layers = await prisma.$queryRaw<{ id: number; expected: Prisma.Decimal; actual: Prisma.Decimal }[]>`
    SELECT cl.id, cl."qtyIn" - COALESCE(SUM(cc.qty), 0) AS expected, cl."qtyRemaining" AS actual
      FROM cost_layers cl LEFT JOIN cost_consumptions cc ON cc."layerId" = cl.id
     WHERE cl."productId" = ${productId} AND cl."periodId" = ${periodId}
     GROUP BY cl.id`;
  for (const l of layers) expect(D(l.actual).toString(), `lớp ${l.id}: remaining = in − Σconsumption`).toBe(D(l.expected).toString());

  const outs = await prisma.$queryRaw<{ id: number; qty_out: Prisma.Decimal; prov: Prisma.Decimal; consumed: Prisma.Decimal }[]>`
    SELECT sl.id, sl."qtyOut" AS qty_out, sl."qtyProvisional" AS prov, COALESCE(SUM(cc.qty), 0) AS consumed
      FROM stock_ledger sl LEFT JOIN cost_consumptions cc ON cc."ledgerId" = sl.id
     WHERE sl."productId" = ${productId} AND sl."periodId" = ${periodId} AND sl."qtyOut" > 0
     GROUP BY sl.id`;
  for (const o of outs) expect(D(o.consumed).plus(o.prov).toString(), `dòng xuất ${o.id}: Σconsumption + provisional = qtyOut`).toBe(D(o.qty_out).toString());
}

type EngineExtra = Partial<Pick<WithInventoryOptions, "inlineLimit" | "mode" | "finalize" | "flushBudgetMs">>;

/** engine(w)(products, ctx => …, extra?) — chạy 1 công việc trong withInventoryTx của thế giới test. */
export const engine = (w: World) =>
  <R,>(products: number[], work: (ctx: EngineCtx) => Promise<R>, extra: EngineExtra = {}) =>
    withInventoryTx(prisma, { periodId: w.periodId, userId: w.userId, products, ...extra }, work);

/** Nhập: chứng từ PURCHASE số n (docId = docLineId = n). */
export const buy = (ctx: EngineCtx, productId: number, qty: Prisma.Decimal.Value, unitCost: Prisma.Decimal.Value, at: Date, n: number) =>
  postReceipt(ctx, { productId, qty, unitCost, docType: "PURCHASE", docId: n, docLineId: n, at });

/** Bán: chứng từ SALE số n (docId = docLineId = n). */
export const sell = (ctx: EngineCtx, productId: number, qty: Prisma.Decimal.Value, at: Date, n: number) =>
  postIssue(ctx, { productId, qty, docType: "SALE", docId: n, docLineId: n, at });

export const saleRow = (docId: number) => prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE", docId } });
export const layersOf = (productId: number) => prisma.costLayer.findMany({ where: { productId }, orderBy: [{ at: "asc" }, { id: "asc" }] });
export const consOf = (ledgerId: number) => prisma.costConsumption.findMany({ where: { ledgerId }, orderBy: { id: "asc" } });

/**
 * Engine FAIL CLOSED khi lan truyền chạm dòng loại "required" (SALE…) chưa có chủ dòng (owners.ts COST_OWNER_POLICY).
 * Test KHÔNG quan tâm cột giá vốn của dòng chứng từ phải KHAI BÁO điều đó: gọi `useNoopCostOwners()` ở cấp file/describe
 * → mỗi test được đăng ký chủ dòng rỗng cho mọi loại bắt buộc (test tự `registerCostOwner` sau đó thì ghi đè), dọn sau test.
 */
export function useNoopCostOwners(): void {
  beforeEach(registerNoopCostOwners);
  afterEach(clearCostOwners);
}
export function registerNoopCostOwners(): void {
  for (const t of OWNER_REQUIRED_DOC_TYPES) registerCostOwner(t, async () => {});
}
