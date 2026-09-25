import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { postIssue, postReceipt, removeDocument, updateLayerCost } from "@/server/inventory/ports";
import type { EngineCtx } from "@/server/inventory/types";
import { resetDb } from "../helpers/db";
import { engine, newWorld, T } from "./helpers";
import { assertChainExact } from "./reference";

beforeEach(resetDb);

/* Property test (plan 02 Task 6): 20 kịch bản ngẫu nhiên có hạt giống; sau MỖI thao tác so engine với mô hình tham
 * chiếu ngây thơ (tests/inventory/reference.ts — assertChainExact: sổ cân + tính lại từng phần == mô hình mô phỏng từ
 * đầu == tính lại từ đầu). Khác bộ chuỗi ngẫu nhiên trong replay.test.ts: thao tác SỬA ở đây ĐỔI số lượng và đôi khi
 * đổi thời điểm (không chỉ sửa y nguyên), và có thao tác khôi phục qua giao dịch khác với `at` + `seq` đã lưu. */

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Kind = "PURCHASE" | "SALE" | "RETURN_IN";
/** Dòng chứng từ như module nghiệp vụ lưu: `at` + `seq` (docs/engine-fifo.md §3). */
interface Doc { kind: Kind; n: number; qty: number; at: number; cost: number; ref?: Doc; seq?: bigint }

/** Đếm thao tác qua MỌI hạt giống — kiểm cuối file rằng bộ sinh thật sự phủ từng loại thao tác. */
const ops: Record<string, number> = {};
const count = (op: string) => { ops[op] = (ops[op] ?? 0) + 1; };

describe("engine == mô hình tham chiếu (property test): chèn lùi thời gian, sửa, hủy, khôi phục, đổi giá lô, trả hàng", () => {
  it.each(Array.from({ length: 20 }, (_, i) => i + 1))("kịch bản ngẫu nhiên #%i", async (seed) => {
    const rnd = mulberry32(seed);
    const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
    const pick = <X,>(xs: X[]): X => xs[int(0, xs.length - 1)]!;
    const w = await newWorld();
    const run = engine(w);
    const pid = w.p.id;
    const live: Doc[] = [];
    const removed: Doc[] = [];
    const log: string[] = []; // chuỗi thao tác — in ra khi đỏ để tái hiện
    let n = 0;

    /** Ghi dòng; `seq` chỉ truyền khi khôi phục qua giao dịch khác (sửa cùng giao dịch: engine tự dùng lại). */
    const post = async (ctx: EngineCtx, d: Doc, seq?: bigint) => {
      const s = seq === undefined ? {} : { seq };
      const base = { productId: pid, qty: d.qty, docId: d.n, docLineId: d.n, at: T(d.at), ...s };
      const r = d.kind === "PURCHASE" ? await postReceipt(ctx, { ...base, docType: "PURCHASE", unitCost: d.cost })
        : d.kind === "SALE" ? await postIssue(ctx, { ...base, docType: "SALE" })
          : await postReceipt(ctx, { ...base, docType: "RETURN_IN", unitCost: 0, costRef: { docType: "SALE", docLineId: d.ref!.n, qty: d.ref!.qty } });
      return r.seq;
    };
    // Dòng bán còn lớp trả dựa vào → engine chặn hủy/sửa (DependentDocumentsError) → bộ sinh không chọn
    const free = () => live.filter((d) => !live.some((x) => x.ref === d));

    try {
      for (let step = 0; step < 14; step++) {
        const logged = log.length;
        const r = rnd();
        if (live.length === 0 || r < 0.28) {
          const d: Doc = { kind: "PURCHASE", n: ++n, qty: int(10, 200), at: int(0, 120), cost: int(1000, 5000) };
          log.push(`nhập #${d.n} ${d.qty}@${d.cost} T${d.at}`);
          d.seq = await run([pid], (ctx) => post(ctx, d));
          live.push(d);
        } else if (r < 0.58) {
          const d: Doc = { kind: "SALE", n: ++n, qty: int(5, 120), at: int(0, 120), cost: 0 };
          log.push(`bán #${d.n} ${d.qty} T${d.at}`);
          d.seq = await run([pid], (ctx) => post(ctx, d));
          live.push(d);
        } else if (r < 0.66) {
          const sales = live.filter((d) => d.kind === "SALE");
          if (!sales.length) continue;
          const src = pick(sales);
          const d: Doc = { kind: "RETURN_IN", n: ++n, qty: int(1, src.qty), at: Math.min(120, src.at + int(0, 20)), cost: 0, ref: src };
          log.push(`trả #${d.n} ${d.qty} của bán #${src.n} T${d.at}`);
          d.seq = await run([pid], (ctx) => post(ctx, d));
          live.push(d);
        } else if (r < 0.8) {
          // SỬA trong 1 giao dịch: đổi SL (và 30% đổi thời điểm) — seq giữ nguyên
          const cands = free();
          if (!cands.length) continue;
          const d = pick(cands);
          const qty = d.kind === "RETURN_IN" ? int(1, d.ref!.qty) : int(5, 150);
          const at = rnd() < 0.3 ? (d.kind === "RETURN_IN" ? Math.min(120, d.ref!.at + int(0, 20)) : int(0, 120)) : d.at;
          log.push(`sửa ${d.kind}#${d.n} SL ${d.qty}→${qty} T${d.at}→T${at}`);
          const seq = await run([pid], async (ctx) => {
            await removeDocument(ctx, d.kind, d.n);
            d.qty = qty;
            d.at = at;
            return post(ctx, d);
          });
          expect(seq, `sửa ${d.kind}#${d.n} giữ seq`).toBe(d.seq);
        } else if (r < 0.88) {
          const cands = free();
          if (!cands.length) continue;
          const d = pick(cands);
          log.push(`hủy ${d.kind}#${d.n}`);
          await run([pid], (ctx) => removeDocument(ctx, d.kind, d.n));
          live.splice(live.indexOf(d), 1);
          removed.push(d);
        } else if (r < 0.94) {
          // KHÔI PHỤC qua giao dịch khác: truyền lại `at` + `seq` đã lưu
          if (!removed.length) continue;
          const d = pick(removed);
          // dòng bán gốc đã hủy, hoặc đã bị sửa sang thời điểm SAU lớp trả → không khôi phục trả hàng (DerivedLayerDateError)
          if (d.ref && (!live.includes(d.ref) || d.ref.at > d.at)) continue;
          log.push(`khôi phục ${d.kind}#${d.n} seq ${d.seq}`);
          const seq = await run([pid], (ctx) => post(ctx, d, d.seq));
          expect(seq).toBe(d.seq);
          removed.splice(removed.indexOf(d), 1);
          live.push(d);
        } else {
          const ins = live.filter((x) => x.kind === "PURCHASE");
          if (ins.length === 0) continue;
          const d = pick(ins);
          d.cost += 150;
          log.push(`đổi giá nhập #${d.n} → ${d.cost}`);
          await run([pid], (ctx) => updateLayerCost(ctx, { docType: "PURCHASE", docId: d.n, unitCost: new Prisma.Decimal(d.cost) }));
        }
        await assertChainExact(w);
        if (log.length > logged) {
          const last = log.at(-1)!;
          count(last.split(" ")[0]!);
          if (last.startsWith("sửa") && !/ T(\d+)→T\1$/.test(last)) count("sửa-đổi-thời-điểm");
        }
      }
    } catch (e) {
      throw new Error(`hạt giống ${seed} — chuỗi thao tác:\n  ${log.join("\n  ")}\n${(e as Error).message}`, { cause: e });
    }
  }, 120_000);

  it("bộ sinh phủ đủ loại thao tác qua 20 kịch bản", () => {
    for (const op of ["nhập", "bán", "trả", "sửa", "sửa-đổi-thời-điểm", "hủy", "khôi", "đổi"]) {
      expect(ops[op] ?? 0, `số thao tác "${op}" (${JSON.stringify(ops)})`).toBeGreaterThanOrEqual(3);
    }
  });
});
