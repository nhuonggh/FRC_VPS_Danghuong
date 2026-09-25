import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { newWorld, T } from "./helpers";

beforeEach(resetDb);

describe("schema bổ sung của engine (migration engine_support)", () => {
  it("recompute_jobs: mặc định PENDING / attempts 0; mỗi mã hàng tối đa 1 job", async () => {
    const w = await newWorld();
    const job = await prisma.recomputeJob.create({ data: { periodId: w.periodId, productId: w.p.id, fromAt: T(0) } });
    expect(job.status).toBe("PENDING");
    expect(job.attempts).toBe(0);
    expect(job.error).toBeNull();
    await expect(
      prisma.recomputeJob.create({ data: { periodId: w.periodId, productId: w.p.id, fromAt: T(5) } }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it("recompute_jobs: có thể đổi trạng thái RUNNING / FAILED và ghi lỗi", async () => {
    const w = await newWorld();
    const job = await prisma.recomputeJob.create({ data: { periodId: w.periodId, productId: w.p.id, fromAt: T(0) } });
    const up = await prisma.recomputeJob.update({ where: { id: job.id }, data: { status: "FAILED", attempts: { increment: 1 }, error: "x" } });
    expect(up.status).toBe("FAILED");
    expect(up.attempts).toBe(1);
  });

  it("index (periodId, productId, qtyProvisional) trên stock_ledger tồn tại", async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'stock_ledger'`;
    expect(rows.some((r) => /\("periodId", "productId", "qtyProvisional"\)/.test(r.indexdef))).toBe(true);
  });

  it("CHECK của plan 01a vẫn còn hiệu lực sau migration mới", async () => {
    const w = await newWorld();
    const base = { periodId: w.periodId, productId: w.p.id, docType: "PURCHASE" as const, docId: 1, docLineId: 1, at: T(0), createdBy: w.userId };
    // vừa nhập vừa xuất
    await expect(prisma.stockLedger.create({ data: { ...base, qtyIn: 1, qtyOut: 1 } })).rejects.toThrow();
    // provisional > qtyOut
    await expect(prisma.stockLedger.create({ data: { ...base, docType: "SALE", qtyOut: 1, qtyProvisional: 2 } })).rejects.toThrow();
    const l = await prisma.stockLedger.create({ data: { ...base, qtyIn: 5 } });
    // remaining > in
    await expect(
      prisma.costLayer.create({ data: { periodId: w.periodId, productId: w.p.id, sourceDocType: "PURCHASE", sourceDocId: 1, sourceLineId: 1, ledgerId: l.id, qtyIn: 5, qtyRemaining: 6, unitCost: 1, at: T(0) } }),
    ).rejects.toThrow();
  });

  it("role app_rw INSERT/UPDATE/DELETE được recompute_jobs (bảng + sequence có quyền)", async () => {
    const w = await newWorld();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE app_rw");
      await tx.$executeRawUnsafe(
        `INSERT INTO recompute_jobs ("periodId", "productId", "fromAt", "updatedAt") VALUES (${w.periodId}, ${w.p.id}, now(), now())`,
      );
      await tx.$executeRawUnsafe(`UPDATE recompute_jobs SET status = 'RUNNING', attempts = attempts + 1`);
      const rows = await tx.$queryRawUnsafe<{ status: string; attempts: number }[]>("SELECT status::text AS status, attempts FROM recompute_jobs");
      expect(rows).toEqual([{ status: "RUNNING", attempts: 1 }]);
      await tx.$executeRawUnsafe("DELETE FROM recompute_jobs");
    });
  });
});
