import { beforeEach, describe, expect, it } from "vitest";
import { clearCostOwners, registerCostOwner, type LineCostSnapshot } from "@/server/inventory/owners";
import { postIssue, postReceipt, updateLayerCost } from "@/server/inventory/ports";
import { prisma, resetDb } from "../helpers/db";
import { buy, engine, layersOf, newWorld, saleRow, sell, T, registerNoopCostOwners, type World } from "./helpers";
import { assertChainExact } from "./reference";

/* Task 7 fix round 1 — lan truyền giá vốn KHÁC MÃ dưới ghi đồng thời. Một dòng gốc (lệnh SX / dòng bán tôn xốp) có
 * dòng sổ ở NHIỀU mã NVL; giao dịch đổi giá NVL M1 và giao dịch đổi giá NVL M2 chỉ khoá mã của mình. Trước bản sửa,
 * `propagate` đọc tổng vốn dòng gốc khi CHƯA khoá các mã NVL khác → mỗi bên thấy nửa cũ của bên kia, bên commit sau ghi
 * đè giá cũ (lost update) lên lớp thành phẩm / chủ dòng. Điều phối tất định: giao dịch A được GIỮ MỞ bằng cổng; chờ
 * giao dịch C thật sự bị chặn trong Postgres (pg_locks chưa granted) hoặc đã xong — không ngủ-và-cầu-may. */

beforeEach(async () => {
  await resetDb();
  clearCostOwners();
  registerNoopCostOwners(); // test không đăng ký chủ dòng SALE thì khai báo rõ: chủ dòng rỗng
});

function gate() {
  let open!: () => void;
  let markHeld!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  const held = new Promise<void>((r) => (markHeld = r));
  return { opened, held, open, markHeld };
}

/**
 * Dọn dẹp CHẮC CHẮN (gọi trong finally): mở cổng để giao dịch đang giữ khoá chạy tiếp và kết thúc, rồi chờ MỌI giao
 * dịch đã khởi chạy xong (thành công hay lỗi). Không có bước này, một assertion đỏ / blockedOrDone hết giờ để giao dịch A
 * treo giữ khoá tới 30 giây → TRUNCATE của resetDb ở test sau bị chặn → đổ dây sang các test khác.
 */
async function release(g: ReturnType<typeof gate>, txs: Promise<unknown>[]): Promise<void> {
  g.open();
  await Promise.allSettled(txs);
}

/** Chờ tới khi `p` đã xong HOẶC có giao dịch đang chờ khoá (bất kỳ loại) trong DB test hiện tại. */
async function blockedOrDone(p: Promise<unknown>, timeoutMs = 10_000): Promise<"blocked" | "done"> {
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (settled) return "done";
    // Chờ khoá advisory (engine) hoặc khoá dòng/transactionid (UPDATE đụng dòng giao dịch khác đang giữ)
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`;
    if (rows[0]!.n > 0) return "blocked";
    if (Date.now() > deadline) throw new Error("giao dịch C không xong cũng không bị chặn");
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Lệnh SX #7: 10 M1 @30.000 + 20 M2 @2.000 → 5 F @68.000; bán 2 F. */
async function productionWorld() {
  const w = await newWorld(3);
  const [m1, m2, f] = w.products as [World["p"], World["p"], World["p"]];
  const run = engine(w);
  await run([m1.id, m2.id], async (ctx) => {
    await buy(ctx, m1.id, 100, 30000, T(0), 1);
    await buy(ctx, m2.id, 100, 2000, T(0), 2);
  });
  await run([m1.id, m2.id, f.id], async (ctx) => {
    await postIssue(ctx, { productId: m1.id, qty: 10, docType: "PRODUCTION_USE", docId: 7, docLineId: 7, at: T(10) });
    await postIssue(ctx, { productId: m2.id, qty: 20, docType: "PRODUCTION_USE", docId: 7, docLineId: 7, at: T(10) });
    await postReceipt(ctx, { productId: f.id, qty: 5, unitCost: 0, docType: "PRODUCTION_OUT", docId: 7, docLineId: 7, at: T(10), costRef: { docType: "PRODUCTION_USE", docLineId: 7, qty: 5 } });
  });
  await run([f.id], (ctx) => sell(ctx, f.id, 2, T(20), 1));
  return { w, run, m1, m2, f };
}

describe("lan truyền khác mã dưới ghi đồng thời: không mất cập nhật (Task 7 fix round 1)", () => {
  it("lệnh SX: A đổi giá M1 (giữ mở SAU khi tính xong), C đổi giá M2 → thành phẩm = M1 mới + M2 mới, đơn bán theo", async () => {
    const { w, run, m1, m2, f } = await productionWorld();
    const g = gate();
    const txs: Promise<unknown>[] = [];
    try {
      const a = run([m1.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 31000 }), {
        finalize: async () => { g.markHeld(); await g.opened; },
      });
      txs.push(a);
      await Promise.race([g.held, a]);
      const c = run([m2.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 2, unitCost: 2500 }));
      txs.push(c);
      await blockedOrDone(c);
      g.open();
      await Promise.all([a, c]);
    } finally {
      await release(g, txs);
    }
    // (10×31.000 + 20×2.500)/5 = 72.000 (giá cũ lẫn: 70.000 nếu C ghi đè bằng M1 cũ)
    expect((await layersOf(f.id))[0]!.unitCost.toString()).toBe("72000");
    expect((await saleRow(1)).unitCostOut.toString()).toBe("72000");
    for (const p of w.products) await assertChainExact(w, p.id);
  });

  it("dòng bán tôn xốp: chủ dòng nhận tổng vốn ĐỦ hai NVL mới (bên ghi sau không mang nửa cũ)", async () => {
    const w = await newWorld(2);
    const [a1, b1] = w.products as [World["p"], World["p"]];
    const calls: LineCostSnapshot[] = [];
    registerCostOwner("SALE", async (_tx, s) => { calls.push(s); });
    const run = engine(w);
    await run([a1.id, b1.id], async (ctx) => { await buy(ctx, a1.id, 100, 100, T(0), 1); await buy(ctx, b1.id, 100, 10, T(0), 2); });
    await run([a1.id, b1.id], async (ctx) => {
      await postIssue(ctx, { productId: a1.id, qty: 10, docType: "SALE", docId: 9, docLineId: 91, at: T(5) });
      await postIssue(ctx, { productId: b1.id, qty: 10, docType: "SALE", docId: 9, docLineId: 91, at: T(5) });
    });
    const g = gate();
    const txs: Promise<unknown>[] = [];
    try {
      const a = run([a1.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 120 }), {
        finalize: async () => { g.markHeld(); await g.opened; },
      });
      txs.push(a);
      await Promise.race([g.held, a]);
      const c = run([b1.id], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: 2, unitCost: 15 }));
      txs.push(c);
      await blockedOrDone(c);
      g.open();
      await Promise.all([a, c]);
    } finally {
      await release(g, txs);
    }
    // Chủ dòng ghi ngược vào dòng đơn: lần gọi CUỐI (bên commit sau) phải là 10×120 + 10×15 = 1.350 (lỗi: 1.150)
    expect(calls.at(-1)!.totalCost.toString()).toBe("1350");
    for (const p of w.products) await assertChainExact(w, p.id);
  });

  it("khoá chéo (A giữ M1 chờ M2, C giữ M2 chờ M1) → Postgres phát hiện deadlock, giao dịch bị hủy CHẠY LẠI trên dữ liệu đã commit, kết quả đúng", async () => {
    const { w, run, m1, m2, f } = await productionWorld();
    const g = gate();
    let aRuns = 0;
    let cRuns = 0;
    const txs: Promise<unknown>[] = [];
    try {
      const a = run([m1.id], async (ctx) => {
        aRuns++;
        await updateLayerCost(ctx, { docType: "PURCHASE", docId: 1, unitCost: 31000 });
        g.markHeld();
        await g.opened; // A giữ M1, chưa flush
      });
      txs.push(a);
      await Promise.race([g.held, a]);
      const c = run([m2.id], async (ctx) => {
        cRuns++;
        await updateLayerCost(ctx, { docType: "PURCHASE", docId: 2, unitCost: 2500 });
      });
      txs.push(c);
      expect(await blockedOrDone(c)).toBe("blocked"); // C lan truyền dòng 7 → cần khoá M1 (A đang giữ)
      g.open(); // A flush → lan truyền dòng 7 → cần khoá M2 (C đang giữ) ⇒ deadlock
      await Promise.all([a, c]);
    } finally {
      await release(g, txs);
    }
    expect(aRuns + cRuns, "đúng một giao dịch bị hủy vì deadlock và chạy lại").toBe(3);
    expect((await layersOf(f.id))[0]!.unitCost.toString()).toBe("72000");
    expect((await saleRow(1)).unitCostOut.toString()).toBe("72000");
    for (const p of w.products) await assertChainExact(w, p.id);
  });
});
