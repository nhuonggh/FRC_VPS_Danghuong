import { Prisma } from "@prisma/client";
import { expect } from "vitest";
import { markDirty } from "@/server/inventory/unit-of-work";
import { prisma } from "../helpers/db";
import { assertLedgerBalanced, engine, layersOf, type World } from "./helpers";

/* ───────────────────────── Mô hình tham chiếu NGÂY THƠ (độc lập với replay.ts) ─────────────────────────
 * Mô phỏng TỪ ĐẦU mọi sự kiện của mã hàng, sắp (at, hạng, seq) — tại cùng `at`: lớp THƯỜNG trước, rồi lệnh XUẤT và
 * lớp PHỤ THUỘC trộn; trong hạng theo `seq` dòng sổ = thứ tự ghi ổn định qua sửa (vòng sửa 4–5):
 *  - lệnh xuất → ăn lớp cũ nhất còn hàng (lớp thường HOẶC lớp phụ thuộc), phần thiếu vào hàng đợi đơn treo;
 *  - lớp THƯỜNG đến → nuốt hàng đợi đơn treo cũ→mới (chỉ bằng lớp thường);
 *  - lớp PHỤ THUỘC (costRef: trả hàng / thành phẩm) KHÔNG nuốt đơn treo (vòng sửa 2 — đổi QUY TẮC spec, không nới
 *    oracle): nó chỉ là tồn cho lệnh xuất đến SAU nó.
 * Giá: số lượng ăn lớp không phụ thuộc giá → pha 1 tính số lượng, pha 2 tính giá MỘT LƯỢT theo thời gian:
 *  - lớp thường: giá lưu trong DB (đầu vào);
 *  - lớp phụ thuộc: TỰ SUY RA = round4(Σ qtyOut × unit_cost_out của dòng gốc / costRefQty), dòng gốc đã được
 *    tính trước đó trong lượt (dòng gốc luôn ở TRƯỚC lớp theo thời gian). Dòng gốc thuộc mã hàng khác (thành
 *    phẩm SX) hoặc chưa có dòng sổ → lấy giá DB (ngoài phạm vi mô hình 1 mã hàng);
 *  - lệnh xuất: round4((Σ qty × giá lớp + phần thiếu × giá tạm) / qty); giá tạm = giá lớp THƯỜNG gần nhất ≤ at
 *    → lớp thường đầu tiên → 0 (gần nhất/đầu tiên theo (at, seq)).                                                                          */
const HP = Prisma.Decimal.clone({ precision: 80, rounding: Prisma.Decimal.ROUND_HALF_UP });
type HPDec = InstanceType<typeof HP>;
const s4 = (v: HPDec) => new Prisma.Decimal(v.toDecimalPlaces(4, HP.ROUND_HALF_UP).toFixed(4)).toString();
const s3 = (v: HPDec) => new Prisma.Decimal(v.toString()).toString();

export interface State {
  layers: string[]; // "id:remaining:unitCost"
  outs: string[]; // "id:unitCostOut:qtyProvisional"
  cons: string[]; // "ledgerId:layerId:qty:unitCost" (sắp xếp)
}

export async function dbState(productId: number): Promise<State> {
  const layers = await layersOf(productId);
  const outs = await prisma.stockLedger.findMany({ where: { productId, qtyOut: { gt: 0 } }, orderBy: { id: "asc" } });
  const cons = await prisma.costConsumption.findMany({ where: { ledger: { productId } } });
  return {
    layers: layers.map((l) => `${l.id}:${l.qtyRemaining.toString()}:${l.unitCost.toString()}`).sort(),
    outs: outs.map((o) => `${o.id}:${o.unitCostOut.toString()}:${o.qtyProvisional.toString()}`).sort(),
    cons: cons.map((c) => `${c.ledgerId}:${c.layerId}:${c.qty.toString()}:${c.unitCost.toString()}`).sort(),
  };
}

export async function referenceState(productId: number): Promise<State> {
  const layers = await prisma.costLayer.findMany({ where: { productId }, include: { ledger: { select: { seq: true } } } });
  const outs = await prisma.stockLedger.findMany({ where: { productId, qtyOut: { gt: 0 } } });
  // Cùng `at` (vòng sửa 4–5): rank 0 = lớp thường; rank 1 = lệnh xuất và lớp phụ thuộc; trong hạng theo `seq` của dòng
  // sổ (thứ tự ghi ỔN ĐỊNH qua sửa/khôi phục). kind: 0 = lớp, 1 = xuất; id = id lớp / id dòng sổ để tra cứu.
  type E = { at: number; rank: 0 | 1; key: bigint; kind: 0 | 1; id: number };
  const evs: E[] = [
    ...layers.map((l): E => ({ at: l.at.getTime(), rank: l.costRefType === null ? 0 : 1, key: l.ledger.seq, kind: 0, id: l.id })),
    ...outs.map((o): E => ({ at: o.at.getTime(), rank: 1, key: o.seq, kind: 1, id: o.id })),
  ].sort((a, b) => a.at - b.at || a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const layerById = new Map(layers.map((l) => [l.id, l]));
  const outById = new Map(outs.map((o) => [o.id, o]));
  const derived = (lid: number) => layerById.get(lid)!.costRefType !== null;

  // ── Pha 1: số lượng ──
  const rem = new Map<number, HPDec>();
  const fifo: number[] = [];
  const queue: { id: number; need: HPDec }[] = [];
  const took = new Map<number, { layerId: number; qty: HPDec }[]>();
  const eat = (outId: number, need: HPDec, plainOnly: boolean): HPDec => {
    for (const lid of fifo) {
      if (need.lte(0)) break;
      const r = rem.get(lid)!;
      if (r.lte(0) || (plainOnly && derived(lid))) continue;
      const q = HP.min(r, need);
      rem.set(lid, r.minus(q));
      need = need.minus(q);
      took.set(outId, [...(took.get(outId) ?? []), { layerId: lid, qty: q }]);
    }
    return need;
  };
  for (const e of evs) {
    if (e.kind === 0) {
      rem.set(e.id, new HP(layerById.get(e.id)!.qtyIn.toString()));
      fifo.push(e.id);
      if (derived(e.id)) continue; // lớp phụ thuộc không nuốt đơn treo
      for (const entry of [...queue]) {
        entry.need = eat(entry.id, entry.need, true);
        if (entry.need.lte(0)) queue.splice(queue.indexOf(entry), 1);
      }
    } else {
      const left = eat(e.id, new HP(outById.get(e.id)!.qtyOut.toString()), false);
      if (left.gt(0)) queue.push({ id: e.id, need: left });
    }
  }

  // ── Pha 2: giá, một lượt theo thời gian ──
  // Giá tạm theo THỨ TỰ SỰ KIỆN (at, seq dòng sổ) — không theo id lớp (id đổi khi sửa phiếu nhập; Task 5 / I1).
  const plain = layers
    .filter((l) => l.costRefType === null)
    .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.ledger.seq < b.ledger.seq ? -1 : a.ledger.seq > b.ledger.seq ? 1 : 0));
  const estimate = (at: Date) => {
    const before = plain.filter((l) => l.at.getTime() <= at.getTime());
    return (before.length ? before[before.length - 1]! : plain[0])?.unitCost.toString() ?? "0";
  };
  const layerCost = new Map<number, string>();
  const outCost = new Map<number, string>();
  const outMissing = new Map<number, HPDec>();
  const allSrc = await prisma.stockLedger.findMany({
    where: { qtyOut: { gt: 0 }, OR: layers.filter((l) => l.costRefType !== null).map((l) => ({ docType: l.costRefType!, docLineId: l.costRefId! })) },
  });
  for (const l of plain) layerCost.set(l.id, l.unitCost.toString());
  for (const e of evs) {
    if (e.kind === 0) {
      const l = layerById.get(e.id)!;
      if (l.costRefType === null) continue;
      const src = allSrc.filter((s) => s.docType === l.costRefType && s.docLineId === l.costRefId);
      if (src.length === 0 || src.some((s) => s.productId !== productId)) { layerCost.set(l.id, l.unitCost.toString()); continue; }
      let total = new HP(0);
      for (const s of src) {
        const c = outCost.get(s.id);
        if (c === undefined) throw new Error(`mô hình: dòng gốc ${s.id} chưa được tính trước lớp ${l.id} (vi phạm thứ tự thời gian)`);
        total = total.plus(new HP(s.qtyOut.toString()).times(c));
      }
      layerCost.set(l.id, s4(total.div(l.costRefQty!.toString())));
    } else {
      const o = outById.get(e.id)!;
      let got = new HP(0);
      let total = new HP(0);
      for (const t of took.get(o.id) ?? []) {
        const c = layerCost.get(t.layerId);
        if (c === undefined) throw new Error(`mô hình: lớp ${t.layerId} chưa có giá khi dòng ${o.id} dùng`);
        got = got.plus(t.qty);
        total = total.plus(t.qty.times(c));
      }
      const missing = new HP(o.qtyOut.toString()).minus(got);
      total = total.plus(missing.times(estimate(o.at)));
      outCost.set(o.id, s4(total.div(o.qtyOut.toString())));
      outMissing.set(o.id, missing);
    }
  }
  // Lượt giá phải xong hết pha 2 trước khi viết consumption (giá lớp phụ thuộc có thể đổi sau khi lệnh xuất ăn nó? KHÔNG:
  // lớp luôn được định giá tại sự kiện của nó, trước mọi lệnh xuất ăn nó).
  const cons: string[] = [];
  for (const [outId, ts] of took) for (const t of ts) cons.push(`${outId}:${t.layerId}:${s3(t.qty)}:${layerCost.get(t.layerId)}`);
  return {
    layers: layers.map((l) => `${l.id}:${s3(rem.get(l.id)!)}:${layerCost.get(l.id)}`).sort(),
    outs: outs.map((o) => `${o.id}:${outCost.get(o.id)}:${s3(outMissing.get(o.id)!)}`).sort(),
    cons: cons.sort(),
  };
}

/**
 * Bất biến MẠNH sau mỗi thao tác: (1) sổ cân; (2) kết quả tính lại TỪNG PHẦN (từ mốc dirty) == mô hình tham
 * chiếu mô phỏng từ đầu (kể cả GIÁ lớp phụ thuộc do mô hình tự suy ra); (3) ép tính lại TỪ ĐẦU kỳ cho đúng cùng
 * kết quả (partial == full, idempotent).
 */
export async function assertChainExact(w: World, productId = w.p.id) {
  await assertLedgerBalanced(productId, w.periodId);
  const partial = await dbState(productId);
  expect(partial, "tính lại từng phần == mô hình tham chiếu").toEqual(await referenceState(productId));
  await engine(w)([productId], async (ctx) => markDirty(ctx, productId, w.period.openedAt));
  expect(await dbState(productId), "tính lại từ đầu == tính lại từng phần").toEqual(partial);
  await assertLedgerBalanced(productId, w.periodId);
}
