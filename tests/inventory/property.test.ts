import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { postIssue, postReceipt, removeDocument, updateLayerCost } from "@/server/inventory/ports";
import type { EngineCtx } from "@/server/inventory/types";
import { prisma, resetDb } from "../helpers/db";
import { engine, newWorld, T, useNoopCostOwners } from "./helpers";
import { assertChainExact } from "./reference";

/* Property test (plan 02 Task 6): 20 kịch bản ngẫu nhiên có hạt giống; sau MỖI thao tác:
 *  (a) so engine với mô hình tham chiếu ngây thơ (tests/inventory/reference.ts — assertChainExact: sổ cân + tính lại
 *      từng phần == mô hình mô phỏng từ đầu == tính lại từ đầu);
 *  (b) so ĐẦU VÀO engine đã ghi (dòng sổ / lớp) với chứng từ của mô hình: oracle (a) đọc đầu vào từ chính các dòng engine
 *      ghi, nên cổng ghi SAI đầu vào (đổi giá không tác dụng, sửa giữ SL cũ, khôi phục sai at/seq, xoá sót dòng) chỉ lộ ở (b).
 * Khác bộ chuỗi ngẫu nhiên trong replay.test.ts: SỬA ở đây ĐỔI số lượng và đôi khi đổi thời điểm, có khôi phục qua
 * giao dịch khác với `at` + `seq` đã lưu, và hạt giống chia hết cho 3 dùng SL 3 số lẻ + giá 4 số lẻ (làm tròn HALF_UP). */

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Kind = "PURCHASE" | "SALE" | "RETURN_IN";
/** Chứng từ trong mô hình. qtyM = SL × 1000 (3 số lẻ), costM = giá × 10.000 (4 số lẻ) — số nguyên, không float. */
interface PlanDoc { kind: Kind; n: number; qtyM: number; at: number; costM: number; refN?: number }
type Op =
  | { t: "post"; d: PlanDoc }
  | { t: "edit"; kind: Kind; n: number; qtyM: number; at: number }
  | { t: "cancel"; kind: Kind; n: number }
  | { t: "restore"; kind: Kind; n: number }
  | { t: "cost"; n: number; costM: number };

const STEPS = 14;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

/**
 * Sinh chuỗi thao tác THUẦN (không DB): lựa chọn chỉ phụ thuộc `rnd` và trạng thái live/removed của chính mô hình,
 * không phụ thuộc kết quả engine → test phủ thao tác chạy độc lập, không cần DB.
 */
function planOps(seed: number): Op[] {
  const rnd = mulberry32(seed);
  const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const pick = <X,>(xs: X[]): X => xs[int(0, xs.length - 1)]!;
  const frac = seed % 3 === 0;
  const qty = (lo: number, hi: number) => (frac ? int(lo * 1000, hi * 1000) : int(lo, hi) * 1000);
  const cost = () => (frac ? int(10_000_000, 50_000_000) : int(1000, 5000) * 10_000);
  const live: PlanDoc[] = [];
  const removed: PlanDoc[] = [];
  const free = () => live.filter((d) => !live.some((x) => x.refN === d.n && x.kind === "RETURN_IN"));
  const ops: Op[] = [];
  let n = 0;

  for (let step = 0; step < STEPS; step++) {
    const r = rnd();
    if (live.length === 0 || r < 0.28) {
      const d: PlanDoc = { kind: "PURCHASE", n: ++n, qtyM: qty(10, 200), at: int(0, 120), costM: cost() };
      live.push(d);
      ops.push({ t: "post", d: { ...d } });
    } else if (r < 0.58) {
      const d: PlanDoc = { kind: "SALE", n: ++n, qtyM: qty(5, 120), at: int(0, 120), costM: 0 };
      live.push(d);
      ops.push({ t: "post", d: { ...d } });
    } else if (r < 0.66) {
      const sales = live.filter((d) => d.kind === "SALE");
      if (!sales.length) continue;
      const src = pick(sales);
      const d: PlanDoc = { kind: "RETURN_IN", n: ++n, qtyM: frac ? int(1, src.qtyM) : int(1, src.qtyM / 1000) * 1000, at: Math.min(120, src.at + int(0, 20)), costM: 0, refN: src.n };
      live.push(d);
      ops.push({ t: "post", d: { ...d } });
    } else if (r < 0.8) {
      // SỬA trong 1 giao dịch: đổi SL (và 30% đổi thời điểm) — seq giữ nguyên
      const cands = free();
      if (!cands.length) continue;
      const d = pick(cands);
      const src = d.refN === undefined ? undefined : live.find((x) => x.n === d.refN)!;
      d.qtyM = src ? (frac ? int(1, src.qtyM) : int(1, src.qtyM / 1000) * 1000) : qty(5, 150);
      if (rnd() < 0.3) d.at = src ? Math.min(120, src.at + int(0, 20)) : int(0, 120);
      ops.push({ t: "edit", kind: d.kind, n: d.n, qtyM: d.qtyM, at: d.at });
    } else if (r < 0.88) {
      const cands = free();
      if (!cands.length) continue;
      const d = pick(cands);
      live.splice(live.indexOf(d), 1);
      removed.push(d);
      ops.push({ t: "cancel", kind: d.kind, n: d.n });
    } else if (r < 0.94) {
      // KHÔI PHỤC qua giao dịch khác (at + seq đã lưu)
      if (!removed.length) continue;
      const d = pick(removed);
      // dòng bán gốc đã hủy, hoặc đã bị sửa sang thời điểm SAU lớp trả → không khôi phục (DerivedLayerDateError)
      const src = d.refN === undefined ? undefined : live.find((x) => x.n === d.refN);
      if (d.refN !== undefined && (!src || src.at > d.at)) continue;
      removed.splice(removed.indexOf(d), 1);
      live.push(d);
      ops.push({ t: "restore", kind: d.kind, n: d.n });
    } else {
      const ins = live.filter((x) => x.kind === "PURCHASE");
      if (ins.length === 0) continue;
      const d = pick(ins);
      d.costM += frac ? 1_503_333 : 1_500_000;
      ops.push({ t: "cost", n: d.n, costM: d.costM });
    }
  }
  return ops;
}

const qtyStr = (qtyM: number) => new Prisma.Decimal(qtyM).div(1000).toString();
const costStr = (costM: number) => new Prisma.Decimal(costM).div(10_000).toString();
const describeOp = (op: Op) =>
  op.t === "post" ? `ghi ${op.d.kind}#${op.d.n} ${qtyStr(op.d.qtyM)}${op.d.kind === "PURCHASE" ? `@${costStr(op.d.costM)}` : ""} T${op.d.at}${op.d.refN ? ` (gốc bán #${op.d.refN})` : ""}`
    : op.t === "edit" ? `sửa ${op.kind}#${op.n} → ${qtyStr(op.qtyM)} T${op.at}`
      : op.t === "cancel" ? `hủy ${op.kind}#${op.n}`
        : op.t === "restore" ? `khôi phục ${op.kind}#${op.n}`
          : `đổi giá nhập #${op.n} → ${costStr(op.costM)}`;

describe("engine == mô hình tham chiếu (property test): chèn lùi thời gian, sửa, hủy, khôi phục, đổi giá lô, trả hàng", () => {
  useNoopCostOwners();
  beforeEach(resetDb); // chỉ khối chạy DB; khối bộ sinh bên dưới thuần, chạy riêng được (-t "phủ")

  it.each(SEEDS)("kịch bản ngẫu nhiên #%i", async (seed) => {
    const w = await newWorld();
    const run = engine(w);
    const pid = w.p.id;
    /** Chứng từ như module nghiệp vụ lưu: đầu vào + `at` + `seq` (docs/engine-fifo.md §3). */
    type Doc = PlanDoc & { seq: bigint };
    const live = new Map<number, Doc>();
    const removed = new Map<number, Doc>();
    const log: string[] = [];

    /** Ghi dòng; `seq` chỉ truyền khi khôi phục qua giao dịch khác (sửa cùng giao dịch: engine tự dùng lại). */
    const post = async (ctx: EngineCtx, d: PlanDoc, seq?: bigint) => {
      const s = seq === undefined ? {} : { seq };
      const base = { productId: pid, qty: qtyStr(d.qtyM), docId: d.n, docLineId: d.n, at: T(d.at), ...s };
      const r = d.kind === "PURCHASE" ? await postReceipt(ctx, { ...base, docType: "PURCHASE", unitCost: costStr(d.costM) })
        : d.kind === "SALE" ? await postIssue(ctx, { ...base, docType: "SALE" })
          : await postReceipt(ctx, { ...base, docType: "RETURN_IN", unitCost: 0, costRef: { docType: "SALE", docLineId: d.refN!, qty: qtyStr(live.get(d.refN!)!.qtyM) } });
      return r.seq;
    };

    /** (b) Đầu vào engine đã ghi == chứng từ mô hình: mỗi chứng từ sống đúng 1 dòng sổ (SL, at, seq) + lớp; chứng từ đã hủy: 0 dòng. */
    const assertInputsMatchModel = async () => {
      const rows = await prisma.stockLedger.findMany({ where: { productId: pid }, include: { layer: true } });
      expect(rows.length, "số dòng sổ == số chứng từ sống").toBe(live.size);
      for (const d of live.values()) {
        const mine = rows.filter((r) => r.docType === d.kind && r.docId === d.n);
        expect(mine.length, `${d.kind}#${d.n}: đúng 1 dòng sổ`).toBe(1);
        const row = mine[0]!;
        const q = new Prisma.Decimal(qtyStr(d.qtyM));
        expect((d.kind === "SALE" ? row.qtyOut : row.qtyIn).toString(), `${d.kind}#${d.n}: SL`).toBe(q.toString());
        expect((d.kind === "SALE" ? row.qtyIn : row.qtyOut).toString(), `${d.kind}#${d.n}: chiều còn lại = 0`).toBe("0");
        expect(row.at.getTime(), `${d.kind}#${d.n}: at`).toBe(T(d.at).getTime());
        expect(row.seq, `${d.kind}#${d.n}: seq DB == seq đã lưu`).toBe(d.seq);
        if (d.kind === "SALE") { expect(row.layer, `SALE#${d.n}: không có lớp`).toBeNull(); continue; }
        const layer = row.layer!;
        expect(layer, `${d.kind}#${d.n}: có lớp`).not.toBeNull();
        expect([layer.qtyIn.toString(), layer.at.getTime(), layer.sourceDocId, layer.sourceLineId], `${d.kind}#${d.n}: lớp`).toEqual([q.toString(), T(d.at).getTime(), d.n, d.n]);
        if (d.kind === "PURCHASE") {
          expect(layer.costRefType, `PURCHASE#${d.n}: lớp thường`).toBeNull();
          expect(layer.unitCost.toString(), `PURCHASE#${d.n}: giá lớp == giá chứng từ`).toBe(costStr(d.costM));
        } else {
          expect([layer.costRefType, layer.costRefId, layer.costRefQty?.toString()], `RETURN_IN#${d.n}: costRef`)
            .toEqual(["SALE", d.refN, qtyStr(live.get(d.refN!)!.qtyM)]);
        }
      }
      for (const d of removed.values()) {
        expect(rows.some((r) => r.docType === d.kind && r.docId === d.n), `${d.kind}#${d.n} đã hủy: không còn dòng sổ`).toBe(false);
      }
      expect(await prisma.costLayer.count({ where: { productId: pid } }), "số lớp == số chứng từ nhập sống")
        .toBe([...live.values()].filter((d) => d.kind !== "SALE").length);
    };

    try {
      for (const op of planOps(seed)) {
        log.push(describeOp(op));
        if (op.t === "post") {
          const d: Doc = { ...op.d, seq: BigInt(0) };
          d.seq = await run([pid], (ctx) => post(ctx, d));
          live.set(d.n, d);
        } else if (op.t === "edit") {
          const d = live.get(op.n)!;
          const next = { ...d, qtyM: op.qtyM, at: op.at };
          const seq = await run([pid], async (ctx) => {
            await removeDocument(ctx, op.kind, op.n);
            return post(ctx, next);
          });
          expect(seq, `sửa ${op.kind}#${op.n}: seq tự dùng lại`).toBe(d.seq);
          live.set(d.n, { ...next, seq: d.seq });
        } else if (op.t === "cancel") {
          const d = live.get(op.n)!;
          await run([pid], (ctx) => removeDocument(ctx, op.kind, op.n));
          live.delete(op.n);
          removed.set(op.n, d);
        } else if (op.t === "restore") {
          const d = removed.get(op.n)!;
          const seq = await run([pid], (ctx) => post(ctx, d, d.seq));
          expect(seq, `khôi phục ${op.kind}#${op.n}: seq đã lưu`).toBe(d.seq);
          removed.delete(op.n);
          live.set(d.n, d);
        } else {
          const d = live.get(op.n)!;
          d.costM = op.costM;
          await run([pid], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: op.n, unitCost: costStr(op.costM) }));
        }
        await assertInputsMatchModel();
        await assertChainExact(w);
      }
    } catch (e) {
      throw new Error(`hạt giống ${seed} — chuỗi thao tác:\n  ${log.join("\n  ")}\n${(e as Error).message}`, { cause: e });
    }
  }, 120_000);
});

describe("bộ sinh property test (thuần, không DB)", () => {
  it("phủ đủ loại thao tác qua 20 hạt giống", () => {
    const ops: Record<string, number> = {};
    const count = (k: string) => { ops[k] = (ops[k] ?? 0) + 1; };
    const lastAt = new Map<string, number>();
    for (const seed of SEEDS) {
      lastAt.clear();
      for (const op of planOps(seed)) {
        count(op.t === "post" ? op.d.kind : op.t);
        if (op.t === "post") lastAt.set(`${op.d.kind}#${op.d.n}`, op.d.at);
        if (op.t === "edit") {
          if (lastAt.get(`${op.kind}#${op.n}`) !== op.at) count("edit-at");
          lastAt.set(`${op.kind}#${op.n}`, op.at);
        }
        if (op.t === "post" && seed % 3 === 0 && (op.d.qtyM % 1000 !== 0 || op.d.costM % 10_000 !== 0)) count("fractional");
      }
    }
    for (const k of ["PURCHASE", "SALE", "RETURN_IN", "edit", "edit-at", "cancel", "restore", "cost", "fractional"]) {
      expect(ops[k] ?? 0, `số thao tác "${k}" (${JSON.stringify(ops)})`).toBeGreaterThanOrEqual(3);
    }
  });

  it("thuần: cùng hạt giống → cùng chuỗi thao tác", () => {
    expect(planOps(7)).toEqual(planOps(7));
  });
});
