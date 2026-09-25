import { beforeEach, describe, expect, it } from "vitest";
import { PeriodClosedError } from "@/server/inventory/errors";
import { withInventoryTx } from "@/server/inventory/unit-of-work";
import { prisma, resetDb } from "../helpers/db";
import { buy, engine, newWorld, T, useNoopCostOwners } from "./helpers";

/* Review I2 — giao dịch kho TUẦN TỰ với kết sổ: engine giữ FOR SHARE trên dòng `periods` (trước mọi khoá advisory), kết
 * sổ (plan 07-F1) giữ FOR UPDATE. Điều phối tất định bằng cổng + pg_stat_activity (như derived-concurrency.test.ts),
 * dọn dẹp chắc chắn trong finally. */

beforeEach(resetDb);
useNoopCostOwners();

function gate() {
  let open!: () => void;
  let markHeld!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  const held = new Promise<void>((r) => (markHeld = r));
  return { opened, held, open, markHeld };
}

async function release(g: ReturnType<typeof gate>, txs: Promise<unknown>[]): Promise<void> {
  g.open();
  await Promise.allSettled(txs);
}

/** Chờ tới khi `p` xong HOẶC có phiên đang chờ khoá (wait_event_type = 'Lock') trong DB test. */
async function blockedOrDone(p: Promise<unknown>, timeoutMs = 10_000): Promise<"blocked" | "done"> {
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (settled) return "done";
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`;
    if (rows[0]!.n > 0) return "blocked";
    if (Date.now() > deadline) throw new Error("giao dịch không xong cũng không bị chặn");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Mô phỏng kết sổ: FOR UPDATE dòng kỳ → (giữ mở tới khi mở cổng) → đóng kỳ, tuỳ chọn mở kỳ mới / rollback. */
function closeTx(periodId: number, g: ReturnType<typeof gate>, opts: { rollback?: boolean; openNext?: boolean } = {}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM periods WHERE id = ${periodId} FOR UPDATE`;
    g.markHeld();
    await g.opened;
    await tx.period.update({ where: { id: periodId }, data: { status: "CLOSED", isOpen: null, closedAt: new Date() } });
    if (opts.openNext) await tx.period.create({ data: { name: "Kỳ mới", isOpen: true, openedAt: new Date("2026-08-01T00:00:00Z") } });
    if (opts.rollback) throw new Error("rollback-close");
  }, { maxWait: 10_000, timeout: 30_000 });
}

describe("giao dịch kho ↔ kết sổ (khoá dòng kỳ)", () => {
  it("kết sổ đang giữ FOR UPDATE → giao dịch kho CHỜ; kết sổ commit → giao dịch kho PeriodClosedError, không ghi gì", async () => {
    const w = await newWorld();
    const g = gate();
    const txs: Promise<unknown>[] = [];
    try {
      const close = closeTx(w.periodId, g);
      txs.push(close);
      await g.held;
      const eng = engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 1, 100, T(0), 1));
      txs.push(eng);
      expect(await blockedOrDone(eng)).toBe("blocked");
      // Chờ đúng khoá dòng kỳ (tuple/transactionid), không phải khoá advisory mã hàng: engine chưa lấy advisory nào
      const adv = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_locks l JOIN pg_database d ON d.oid = l.database
         WHERE d.datname = current_database() AND l.locktype = 'advisory'`;
      expect(adv[0]!.n).toBe(0);
      g.open();
      await close;
      await expect(eng).rejects.toThrow(PeriodClosedError);
      expect(await prisma.stockLedger.count()).toBe(0);
    } finally {
      await release(g, txs);
    }
  });

  it("kết sổ ROLLBACK → giao dịch kho đang chờ chạy tiếp bình thường", async () => {
    const w = await newWorld();
    const g = gate();
    const txs: Promise<unknown>[] = [];
    try {
      const close = closeTx(w.periodId, g, { rollback: true });
      txs.push(close);
      await g.held;
      const eng = engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 1, 100, T(0), 1));
      txs.push(eng);
      expect(await blockedOrDone(eng)).toBe("blocked");
      g.open();
      await expect(close).rejects.toThrow("rollback-close");
      await eng;
      expect(await prisma.stockLedger.count()).toBe(1);
    } finally {
      await release(g, txs);
    }
  });

  it("giao dịch kho đang chạy → kết sổ (FOR UPDATE) CHỜ tới khi giao dịch kho commit", async () => {
    const w = await newWorld();
    const g = gate();
    const txs: Promise<unknown>[] = [];
    try {
      const eng = engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 1, 100, T(0), 1), {
        finalize: async () => { g.markHeld(); await g.opened; },
      });
      txs.push(eng);
      await g.held;
      const close = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM periods WHERE id = ${w.periodId} FOR UPDATE`;
        await tx.period.update({ where: { id: w.periodId }, data: { status: "CLOSED", isOpen: null, closedAt: new Date() } });
      });
      txs.push(close);
      expect(await blockedOrDone(close)).toBe("blocked");
      g.open();
      await eng;
      await close;
      expect(await prisma.stockLedger.count()).toBe(1);
      expect((await prisma.period.findUniqueOrThrow({ where: { id: w.periodId } })).status).toBe("CLOSED");
    } finally {
      await release(g, txs);
    }
  });

  it("không truyền periodId: kỳ bị đóng + mở kỳ mới trong lúc chờ → giao dịch kho chạy trên KỲ MỚI", async () => {
    const w = await newWorld();
    const g = gate();
    const txs: Promise<unknown>[] = [];
    try {
      const close = closeTx(w.periodId, g, { openNext: true });
      txs.push(close);
      await g.held;
      const eng = withInventoryTx(prisma, { userId: w.userId, products: [w.p.id] }, async (ctx) => {
        await buy(ctx, w.p.id, 1, 100, T(0), 1);
        return ctx.period.id;
      });
      txs.push(eng);
      expect(await blockedOrDone(eng)).toBe("blocked");
      g.open();
      await close;
      const next = await prisma.period.findFirstOrThrow({ where: { isOpen: true } });
      expect(next.id).not.toBe(w.periodId);
      expect(await eng).toBe(next.id);
    } finally {
      await release(g, txs);
    }
  });
});
