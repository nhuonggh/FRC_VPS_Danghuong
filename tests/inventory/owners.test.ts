import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngineInvariantError } from "@/server/inventory/errors";
import {
  clearCostOwners, COST_OWNER_POLICY, OWNER_REQUIRED_DOC_TYPES, registerCostOwner, resolveCostOwner, type LineCostSnapshot,
} from "@/server/inventory/owners";
import { registerAllCostOwners } from "@/server/inventory/owners-register";
import { postIssue, removeDocument } from "@/server/inventory/ports";
import { runRecomputeJobs } from "@/server/inventory/recompute";
import { OUT_DOC_TYPES, IN_DOC_TYPES } from "@/server/inventory/types";
import { prisma, resetDb } from "../helpers/db";
import { buy, engine, newWorld, saleRow, sell, T } from "./helpers";

beforeEach(async () => {
  await resetDb();
  clearCostOwners(); // CỐ Ý không đăng ký chủ dòng rỗng: file này kiểm chính quy tắc fail closed
});
afterEach(clearCostOwners);

describe("chính sách chủ dòng (review I1 — fail closed)", () => {
  it("COST_OWNER_POLICY phủ ĐÚNG mọi loại xuất; SALE bắt buộc", () => {
    expect(Object.keys(COST_OWNER_POLICY).sort()).toEqual([...OUT_DOC_TYPES].sort());
    expect(OWNER_REQUIRED_DOC_TYPES).toContain("SALE");
  });

  it("resolveCostOwner: loại bắt buộc chưa đăng ký ⇒ EngineInvariantError chỉ chỗ đăng ký; loại tuỳ chọn ⇒ undefined; loại nhập ⇒ lỗi", () => {
    expect(() => resolveCostOwner("SALE")).toThrow(EngineInvariantError);
    expect(() => resolveCostOwner("SALE")).toThrow(/owners-register\.ts/);
    expect(resolveCostOwner("ADJ_LOSS")).toBeUndefined();
    expect(() => resolveCostOwner(IN_DOC_TYPES[0])).toThrow(EngineInvariantError);
    const o = async () => {};
    registerCostOwner("SALE", o);
    expect(resolveCostOwner("SALE")).toBe(o);
  });

  it("registerAllCostOwners idempotent, không ghi đè chủ dòng đã đăng ký", () => {
    const o = async () => {};
    registerCostOwner("SALE", o);
    registerAllCostOwners();
    registerAllCostOwners();
    expect(resolveCostOwner("SALE")).toBe(o);
  });
});

describe("engine (giao dịch đồng bộ) — thiếu chủ dòng", () => {
  it("bán SALE mà chưa đăng ký chủ dòng ⇒ EngineInvariantError, KHÔNG commit gì", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 100, T(0), 1));
    await expect(run([w.p.id], (ctx) => sell(ctx, w.p.id, 3, T(1), 1))).rejects.toThrow(EngineInvariantError);
    expect(await prisma.stockLedger.count({ where: { docType: "SALE" } })).toBe(0);
  });

  it("loại xuất tuỳ chọn (ADJ_LOSS) không cần chủ dòng", async () => {
    const w = await newWorld();
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 100, T(0), 1));
    await run([w.p.id], (ctx) => postIssue(ctx, { productId: w.p.id, qty: 2, docType: "ADJ_LOSS", docId: 1, docLineId: 1, at: T(1) }));
    expect(await prisma.stockLedger.count({ where: { docType: "ADJ_LOSS" } })).toBe(1);
  });

  it("đã đăng ký ⇒ chủ dòng được gọi với snapshot đúng", async () => {
    const w = await newWorld();
    const run = engine(w);
    const snaps: LineCostSnapshot[] = [];
    registerCostOwner("SALE", async (_tx, s) => { snaps.push(s); });
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 100, T(0), 1));
    await run([w.p.id], (ctx) => sell(ctx, w.p.id, 3, T(1), 7));
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.docLineId).toBe(7);
    expect(snaps[0]!.totalCost.toString()).toBe("300");
  });
});

describe("worker nền — thiếu / có chủ dòng", () => {
  /** Chuỗi 4 đơn bán rồi hủy đơn đầu với inlineLimit 2 ⇒ hoãn cho worker. */
  async function deferredChain(onSale: (s: LineCostSnapshot) => void) {
    const w = await newWorld();
    const run = engine(w);
    registerCostOwner("SALE", async (_tx, s) => onSale(s));
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 100, T(0), 1));
    for (let i = 1; i <= 4; i++) await run([w.p.id], (ctx) => sell(ctx, w.p.id, 5, T(i), i));
    await run([w.p.id], (ctx) => removeDocument(ctx, "SALE", 1), { inlineLimit: 2 });
    expect((await prisma.recomputeJob.findUniqueOrThrow({ where: { productId: w.p.id } })).status).toBe("PENDING");
    return w;
  }

  it("worker chạy job mà registry trống (bundle chưa đăng ký) ⇒ job FAILED với EngineInvariantError, cờ vẫn chặn", async () => {
    const w = await deferredChain(() => {});
    clearCostOwners(); // mô phỏng bundle instrumentation chưa có chủ dòng
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await runRecomputeJobs(prisma)).toBe(0);
    } finally {
      err.mockRestore();
    }
    const job = await prisma.recomputeJob.findUniqueOrThrow({ where: { productId: w.p.id } });
    expect(job.status).toBe("FAILED");
    expect(job.error).toMatch(/Chưa đăng ký chủ dòng/);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: w.p.id } })).recomputing).toBe(true);
  });

  it("worker có chủ dòng ⇒ gọi chủ dòng cho các dòng bán được tính lại", async () => {
    const seen: number[] = [];
    const w = await deferredChain((s) => seen.push(s.docLineId));
    seen.length = 0;
    expect(await runRecomputeJobs(prisma)).toBe(1);
    expect(seen.sort()).toEqual([2, 3, 4]);
    expect((await saleRow(4)).qtyProvisional.toString()).toBe("0");
    expect(await prisma.recomputeJob.count({ where: { productId: w.p.id } })).toBe(0);
  });
});
