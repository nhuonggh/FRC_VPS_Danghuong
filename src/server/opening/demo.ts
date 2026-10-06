import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { normalizeSearch } from "@/lib/search";
import { ictStartOfDay, toIct } from "@/lib/time";
import { writeAudit } from "@/server/audit/write";
import { postReceipt, removeDocument, withInventoryTx } from "@/server/inventory";
import { getOpenPeriod } from "@/server/period/guard";
import data from "./demo-data.json";

/**
 * SỐ DEMO để test giai đoạn đầu: công nợ (từ cột số dư file khách), tồn kho, số dư quỹ, chiết khấu tích lũy.
 * Mọi dòng nạp có `isDemo = true`; reset chỉ xoá đúng các dòng đó (số thật nhập Excel giữ nguyên; nhập Excel ghi đè một dòng demo
 * sẽ gỡ cờ demo của dòng đó). Nạp KHÔNG ghi đè dòng đã có (demo hay thật). Chỉ người có `period.close` (giám đốc).
 */
export const DEMO_LABEL = "Số demo — sẽ reset khi chạy chính thức";
export interface DemoStatus { debt: number; stock: number; cash: number; discount: number; total: number }
export interface DemoLoadResult extends DemoStatus { skipped: number }

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export async function demoStatus(db: Db): Promise<DemoStatus> {
  const period = await getOpenPeriod(db); const where = { periodId: period.id, isDemo: true };
  const [stock, debt, cash, discount] = await Promise.all([db.openingStock.count({ where }), db.openingDebt.count({ where }), db.openingCash.count({ where }), db.openingDiscount.count({ where })]);
  return { stock, debt, cash, discount, total: stock + debt + cash + discount };
}

export async function loadDemoOpening(prisma: PrismaClient, actor: Actor): Promise<DemoLoadResult> {
  assertCan(actor.perms, "period.close");
  const period = await getOpenPeriod(prisma);
  const [partners, products, accounts, haveStock] = await Promise.all([
    prisma.partner.findMany({ where: { mergedIntoId: null }, select: { id: true, code: true, isCustomer: true } }),
    prisma.product.findMany({ select: { id: true, code: true, kind: true } }),
    prisma.cashAccount.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    prisma.openingStock.findMany({ where: { periodId: period.id }, select: { productId: true } }),
  ]);
  const partnerBy = new Map(partners.map((p) => [p.code.toUpperCase(), p])); const productBy = new Map(products.map((p) => [p.code.toUpperCase(), p]));
  const accountBy = new Map(accounts.map((a) => [normalizeSearch(a.name), a.id])); const stocked = new Set(haveStock.map((s) => s.productId));
  let skipped = 0;

  const debtRows = data.debts.flatMap((d) => { const p = partnerBy.get(d.code.toUpperCase()); if (!p) { skipped++; return []; } return [{ periodId: period.id, partnerId: p.id, amount: D(d.amount), isDemo: true }]; });
  const discountRows = data.discounts.flatMap((d) => { const p = partnerBy.get(d.code.toUpperCase()); if (!p?.isCustomer) { skipped++; return []; } return [{ periodId: period.id, partnerId: p.id, amount: D(d.amount), isDemo: true }]; });
  const cashRows = data.cash.flatMap((c) => { const id = accountBy.get(normalizeSearch(c.name)); if (!id) { skipped++; return []; } return [{ periodId: period.id, cashAccountId: id, amount: D(c.amount), isDemo: true }]; });
  const stockRows = data.stock.flatMap((s) => { const p = productBy.get(s.code.toUpperCase()); if (!p || p.kind === "NVL" || stocked.has(p.id)) { skipped++; return []; } return [{ productId: p.id, qty: D(s.qty), unitCost: D(s.unitCost) }]; });

  const o = toIct(period.openedAt); const at = ictStartOfDay(o.y, o.m, o.d);
  const counts = { debt: 0, discount: 0, cash: 0, stock: 0 };
  await withInventoryTx(prisma, { userId: actor.userId, periodId: period.id, products: [...new Set(stockRows.map((r) => r.productId))].sort((a, b) => a - b) }, async (ctx) => {
    const tx = ctx.tx;
    counts.debt = (await tx.openingDebt.createMany({ data: debtRows, skipDuplicates: true })).count;
    counts.discount = (await tx.openingDiscount.createMany({ data: discountRows, skipDuplicates: true })).count;
    counts.cash = (await tx.openingCash.createMany({ data: cashRows, skipDuplicates: true })).count;
    for (const r of stockRows) {
      const id = (await tx.openingStock.create({ data: { periodId: period.id, ...r, isDemo: true }, select: { id: true } })).id;
      await postReceipt(ctx, { productId: r.productId, qty: r.qty.toString(), unitCost: r.unitCost.toString(), docType: "OPENING", docId: id, docLineId: id, at });
      counts.stock++;
    }
    await writeAudit(tx, { userId: actor.userId, action: "opening.demo.load", entity: "OpeningDemo", entityId: period.id, after: counts });
  });
  return { ...counts, total: counts.debt + counts.discount + counts.cash + counts.stock, skipped };
}

export async function resetDemoOpening(prisma: PrismaClient, actor: Actor): Promise<DemoStatus> {
  assertCan(actor.perms, "period.close");
  const period = await getOpenPeriod(prisma); const where = { periodId: period.id, isDemo: true };
  const stock = await prisma.openingStock.findMany({ where, select: { id: true, productId: true } });
  const removed = { stock: 0, debt: 0, cash: 0, discount: 0 };
  await withInventoryTx(prisma, { userId: actor.userId, periodId: period.id, products: [...new Set(stock.map((s) => s.productId))].sort((a, b) => a - b) }, async (ctx) => {
    const tx = ctx.tx;
    for (const s of stock) { await removeDocument(ctx, "OPENING", s.id); await tx.openingStock.delete({ where: { id: s.id } }); removed.stock++; }
    removed.debt = (await tx.openingDebt.deleteMany({ where })).count;
    removed.cash = (await tx.openingCash.deleteMany({ where })).count;
    removed.discount = (await tx.openingDiscount.deleteMany({ where })).count;
    await writeAudit(tx, { userId: actor.userId, action: "opening.demo.reset", entity: "OpeningDemo", entityId: period.id, before: removed });
  });
  return { ...removed, total: removed.stock + removed.debt + removed.cash + removed.discount };
}
