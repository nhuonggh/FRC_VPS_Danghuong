import { beforeEach, describe, expect, it } from "vitest";
import { docTimestamp, postReceipt } from "@/server/inventory";
import { withIdempotentInventoryTx } from "@/server/idempotency/with-inventory-tx";
import { prisma, resetDb } from "../helpers/db";
import { makePeriod, makeProduct, makeUser } from "../helpers/factories";
let userId: number; let productId: number;
beforeEach(async () => { await resetDb(); userId = (await makeUser()).id; await makePeriod({ openedAt: new Date("2026-08-01T00:00:00Z") }); productId = (await makeProduct()).id; });
const receive = (key: string, calls: { n: number }) => withIdempotentInventoryTx(prisma, { userId, products: [productId], scope: "test.receive", key }, async (ctx) => { calls.n++; await postReceipt(ctx, { productId, qty: 10, unitCost: 100, docType: "PURCHASE", docId: 1, docLineId: 1, at: docTimestamp("2026-08-05", new Date()) }); return { id: 1 }; });
describe("withIdempotentInventoryTx", () => {
  it("lặp cùng khoá chỉ ghi kho một lần", async () => { const calls = { n: 0 }; const first = await receive("k1", calls); const second = await receive("k1", calls); expect(second).toEqual(first); expect(calls.n).toBe(1); expect(await prisma.stockLedger.count()).toBe(1); expect(await prisma.costLayer.count()).toBe(1); });
  it("5 request đồng thời cùng khoá trả cùng kết quả", async () => { const calls = { n: 0 }; const rows = await Promise.all(Array.from({ length: 5 }, () => receive("same", calls))); expect(new Set(rows.map((row) => JSON.stringify(row))).size).toBe(1); expect(calls.n).toBe(1); expect(await prisma.stockLedger.count()).toBe(1); });
  it("rollback cả khoá và sổ kho; retry được", async () => { let attempts = 0; const run = () => withIdempotentInventoryTx(prisma, { userId, products: [productId], scope: "test.fail", key: "f" }, async (ctx) => { attempts++; await postReceipt(ctx, { productId, qty: 1, unitCost: 1, docType: "PURCHASE", docId: 9, docLineId: 9, at: docTimestamp("2026-08-05", new Date()) }); if (attempts === 1) throw new Error("boom"); return { ok: true }; }); await expect(run()).rejects.toThrow("boom"); expect(await prisma.idempotencyKey.count()).toBe(0); expect(await prisma.stockLedger.count()).toBe(0); await expect(run()).resolves.toEqual({ ok: true }); });
});
