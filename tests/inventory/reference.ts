import { Prisma } from "@prisma/client";
import { expect } from "vitest";
import { markDirty } from "@/server/inventory/unit-of-work";
import { prisma } from "../helpers/db";
import { assertLedgerBalanced, engine, layersOf, type World } from "./helpers";

/* ───────────────────────── Mô hình tham chiếu NGÂY THƠ (độc lập với replay.ts) ─────────────────────────
 * Mô phỏng TỪ ĐẦU mọi sự kiện của mã hàng: sắp (at, nhập trước xuất, id); lớp đến → nuốt hàng đợi đơn treo
 * cũ→mới; lệnh xuất → ăn lớp cũ nhất, phần thiếu vào hàng đợi. Giá tạm phần thiếu = giá nhập gần nhất ≤ at
 * (không tính lớp phụ thuộc) → lớp đầu tiên → 0. unit_cost_out = tổng/qty, HALF_UP 4 số.
 * Quy tắc spec bổ sung (vòng sửa 1 — đổi QUY TẮC, không nới lỏng oracle): lớp phụ thuộc (costRef) KHÔNG cấp
 * hàng cho chính dòng gốc của nó — cả khi dòng gốc là đơn treo lẫn khi nó xuất bình thường. Hàng đợi được
 * duyệt HẾT cũ→mới mỗi khi có lớp đến (đơn không dùng được lớp đó thì đơn sau vẫn dùng được).             */
const HP = Prisma.Decimal.clone({ precision: 80, rounding: Prisma.Decimal.ROUND_HALF_UP });
type HPDec = InstanceType<typeof HP>;

export interface State {
  layers: string[]; // "id:remaining"
  outs: string[]; // "id:unitCostOut:qtyProvisional"
  cons: string[]; // "ledgerId:layerId:qty:unitCost" (sắp xếp)
}

export async function dbState(productId: number): Promise<State> {
  const layers = await layersOf(productId);
  const outs = await prisma.stockLedger.findMany({ where: { productId, qtyOut: { gt: 0 } }, orderBy: { id: "asc" } });
  const cons = await prisma.costConsumption.findMany({ where: { ledger: { productId } } });
  return {
    layers: layers.map((l) => `${l.id}:${l.qtyRemaining.toString()}`).sort(),
    outs: outs.map((o) => `${o.id}:${o.unitCostOut.toString()}:${o.qtyProvisional.toString()}`).sort(),
    cons: cons.map((c) => `${c.ledgerId}:${c.layerId}:${c.qty.toString()}:${c.unitCost.toString()}`).sort(),
  };
}

export async function referenceState(productId: number): Promise<State> {
  const layers = await prisma.costLayer.findMany({ where: { productId } });
  const outs = await prisma.stockLedger.findMany({ where: { productId, qtyOut: { gt: 0 } } });
  type E = { at: number; kind: 0 | 1; id: number };
  const evs: E[] = [
    ...layers.map((l): E => ({ at: l.at.getTime(), kind: 0, id: l.id })),
    ...outs.map((o): E => ({ at: o.at.getTime(), kind: 1, id: o.id })),
  ].sort((a, b) => a.at - b.at || a.kind - b.kind || a.id - b.id);
  const layerById = new Map(layers.map((l) => [l.id, l]));
  const outById = new Map(outs.map((o) => [o.id, o]));
  const rem = new Map<number, HPDec>();
  const fifo: number[] = [];
  const queue: { id: number; need: HPDec }[] = [];
  const got = new Map<number, { qty: HPDec; cost: HPDec }>();
  const cons: string[] = [];
  const eat = (outId: number, need: HPDec): HPDec => {
    const out = outById.get(outId)!;
    for (const lid of fifo) {
      if (need.lte(0)) break;
      const r = rem.get(lid)!;
      if (r.lte(0)) continue;
      const L = layerById.get(lid)!;
      if (L.costRefType === out.docType && L.costRefId === out.docLineId) continue; // không tự cấp cho dòng gốc
      const q = HP.min(r, need);
      rem.set(lid, r.minus(q));
      need = need.minus(q);
      cons.push(`${outId}:${lid}:${new Prisma.Decimal(q.toString()).toString()}:${L.unitCost.toString()}`);
      const g = got.get(outId) ?? { qty: new HP(0), cost: new HP(0) };
      got.set(outId, { qty: g.qty.plus(q), cost: g.cost.plus(q.times(L.unitCost.toString())) });
    }
    return need;
  };
  for (const e of evs) {
    if (e.kind === 0) {
      rem.set(e.id, new HP(layerById.get(e.id)!.qtyIn.toString()));
      fifo.push(e.id);
      for (const entry of [...queue]) {
        entry.need = eat(entry.id, entry.need);
        if (entry.need.lte(0)) queue.splice(queue.indexOf(entry), 1);
      }
    } else {
      const left = eat(e.id, new HP(outById.get(e.id)!.qtyOut.toString()));
      if (left.gt(0)) queue.push({ id: e.id, need: left });
    }
  }
  const plain = layers.filter((l) => l.costRefType === null).sort((a, b) => a.at.getTime() - b.at.getTime() || a.id - b.id);
  const estimate = (at: Date) => {
    const before = plain.filter((l) => l.at.getTime() <= at.getTime());
    return (before.length ? before[before.length - 1]! : plain[0])?.unitCost.toString() ?? "0";
  };
  return {
    layers: layers.map((l) => `${l.id}:${new Prisma.Decimal(rem.get(l.id)!.toString()).toString()}`).sort(),
    outs: outs
      .map((o) => {
        const g = got.get(o.id) ?? { qty: new HP(0), cost: new HP(0) };
        const missing = new HP(o.qtyOut.toString()).minus(g.qty);
        const total = g.cost.plus(missing.times(estimate(o.at)));
        const unit = total.div(o.qtyOut.toString()).toDecimalPlaces(4, HP.ROUND_HALF_UP);
        return `${o.id}:${new Prisma.Decimal(unit.toString()).toString()}:${new Prisma.Decimal(missing.toString()).toString()}`;
      })
      .sort(),
    cons: cons.sort(),
  };
}

/**
 * Bất biến MẠNH sau mỗi thao tác: (1) sổ cân; (2) kết quả tính lại TỪNG PHẦN (từ mốc dirty) == mô hình tham
 * chiếu mô phỏng từ đầu; (3) ép tính lại TỪ ĐẦU kỳ cho đúng cùng kết quả (partial == full, idempotent).
 */
export async function assertChainExact(w: World, productId = w.p.id) {
  await assertLedgerBalanced(productId, w.periodId);
  const partial = await dbState(productId);
  expect(partial, "tính lại từng phần == mô hình tham chiếu").toEqual(await referenceState(productId));
  await engine(w)([productId], async (ctx) => markDirty(ctx, productId, w.period.openedAt));
  expect(await dbState(productId), "tính lại từ đầu == tính lại từng phần").toEqual(partial);
  await assertLedgerBalanced(productId, w.periodId);
}
