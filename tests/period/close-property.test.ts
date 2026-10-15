import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/permissions/catalog";
import type { Actor } from "@/lib/permissions/scope";
import { postCashLedger } from "@/server/cash/ledger";
import { closePeriod } from "@/server/closing/service";
import { postPartnerLedger } from "@/server/debt/ledger";
import { captureTotals, diffTotals } from "@/server/period/rehearsal";
import { prisma, resetDb } from "../helpers/db";
import { makeCashAccount, makePartner, makeProduct } from "../helpers/factories";
import { buy, engine, newWorld, sell, T, useNoopCostOwners, type World } from "../inventory/helpers";

/**
 * Cổng chất lượng Plan 07 #1: bất biến kết sổ trên DỮ LIỆU NGẪU NHIÊN (PRNG có seed ⇒ lỗi tái hiện được):
 * tồn từng mã (số lượng + giá trị), công nợ từng đối tác, từng quỹ, chiết khấu từng đối tác — TRƯỚC = SAU, đọc bằng các hàm báo
 * cáo của ứng dụng (đường độc lập với bước tự kiểm trong engine). Kết sổ liên tiếp cũng giữ bất biến.
 */
useNoopCostOwners();
const ALL = new Set(PERMISSIONS.map((p) => p.code));
const mulberry32 = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
let w: World; let actor: Actor;

beforeEach(async () => { await resetDb(); w = await newWorld(1); actor = { userId: w.userId, perms: ALL }; });

async function randomPeriod(seed: number) {
  const rnd = mulberry32(seed), int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const products = [w.p, ...(await Promise.all(Array.from({ length: 5 }, () => makeProduct())))];
  const partners = await Promise.all(Array.from({ length: 4 }, () => makePartner()));
  const accounts = await Promise.all([makeCashAccount(), makeCashAccount()]);
  const stock = new Map<number, number>(), run = engine(w);
  let doc = 0, clock = 0;
  for (let i = 0; i < 40; i++) {
    const p = products[int(0, products.length - 1)]!, have = stock.get(p.id) ?? 0;
    if (have > 2 && rnd() < 0.45) {
      const qty = int(1, have);
      await run([p.id], (ctx) => sell(ctx, p.id, qty, T(++clock), ++doc));
      stock.set(p.id, have - qty);
    } else {
      const qty = int(1, 30);
      await run([p.id], (ctx) => buy(ctx, p.id, qty, int(50, 500) + int(0, 99) / 100, T(++clock), ++doc));
      stock.set(p.id, have + qty);
    }
  }
  for (const part of partners) {
    if (rnd() < 0.7) await prisma.openingDebt.create({ data: { periodId: w.periodId, partnerId: part.id, amount: int(-500, 900) } });
    if (rnd() < 0.5) await prisma.openingDiscount.create({ data: { periodId: w.periodId, partnerId: part.id, amount: int(0, 300) } });
  }
  for (const a of accounts) if (rnd() < 0.8) await prisma.openingCash.create({ data: { periodId: w.periodId, cashAccountId: a.id, amount: int(0, 5000) } });
  await prisma.$transaction(async (t: Prisma.TransactionClient) => {
    for (let i = 0; i < 30; i++) {
      const base = { periodId: w.periodId, createdBy: w.userId, at: T(100 + i), docId: 1000 + i };
      const part = partners[int(0, partners.length - 1)]!, amount = int(1, 700) + int(0, 99) / 100;
      await postPartnerLedger(t, { ...base, partnerId: part.id, side: rnd() < 0.6 ? "debit" : "credit", amount, docType: "DELIVERY" });
      await postCashLedger(t, { ...base, cashAccountId: accounts[int(0, 1)]!.id, side: rnd() < 0.5 ? "in" : "out", amount, docType: "RECEIPT" });
      if (rnd() < 0.4) await t.discountLedger.create({ data: { periodId: w.periodId, partnerId: part.id, ...(rnd() < 0.5 ? { amountIn: int(1, 90) } : { amountOut: int(1, 20) }), docType: "SALE", docId: base.docId, at: base.at, createdBy: w.userId } });
    }
  });
}

describe("bất biến kết sổ trên dữ liệu ngẫu nhiên", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])("seed %i: trước = sau; kết sổ lần 2 cũng trước = sau; sổ kỳ cũ giữ nguyên", async (seed) => {
    await randomPeriod(seed);
    const before = await captureTotals(prisma, actor);
    expect(Object.keys(before.stock).length).toBeGreaterThan(0);
    const ledgerA = await prisma.stockLedger.count({ where: { periodId: w.periodId } });
    await closePeriod(prisma, actor, { now: new Date("2026-10-01T03:00:00Z") });
    const after = await captureTotals(prisma, actor);
    expect(diffTotals(before, after)).toEqual([]);
    expect(after.periodId).not.toBe(before.periodId);
    expect(await prisma.stockLedger.count({ where: { periodId: w.periodId } })).toBe(ledgerA);
    await closePeriod(prisma, actor, { now: new Date("2026-11-01T03:00:00Z") });
    expect(diffTotals(before, await captureTotals(prisma, actor))).toEqual([]);
  });

  it("công cụ so sánh NHẠY: sửa một số đầu kỳ sau kết sổ thì diffTotals báo đúng chỉ tiêu lệch", async () => {
    await randomPeriod(42);
    const before = await captureTotals(prisma, actor);
    const out = await closePeriod(prisma, actor, { now: new Date("2026-10-01T03:00:00Z") });
    const target = await prisma.openingDebt.findFirstOrThrow({ where: { periodId: out.newPeriod.id } });
    await prisma.openingDebt.update({ where: { id: target.id }, data: { amount: new Prisma.Decimal(target.amount).plus(1) } });
    const diffs = diffTotals(before, await captureTotals(prisma, actor));
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ what: "công nợ", key: String(target.partnerId) });
    const layer = await prisma.costLayer.findFirstOrThrow({ where: { periodId: out.newPeriod.id }, orderBy: { id: "asc" } });
    await prisma.costLayer.update({ where: { id: layer.id }, data: { unitCost: new Prisma.Decimal(layer.unitCost).plus(1) } });
    expect(diffTotals(before, await captureTotals(prisma, actor)).some((d) => d.what === "tồn (giá trị)")).toBe(true);
  });
});
