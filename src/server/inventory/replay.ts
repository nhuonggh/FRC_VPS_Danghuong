import { Prisma, type StockDocType } from "@prisma/client";
import { ReplayTooLargeError } from "./errors";
import { restoreLayerRemaining } from "./layers";
import { assertLocked } from "./lock";
import { estimateCost } from "./queries";
import type { Dec, EngineCtx } from "./types";

/**
 * Số học TIỀN độ chính xác cao: Prisma.Decimal mặc định chỉ giữ 20 chữ số có nghĩa, trong khi
 * Σ qty(18,3) × giá(18,4) có thể cần > 20 chữ số → làm tròn ngầm trước khi chia. Mọi phép nhân/cộng tiền và
 * phép chia ra giá đơn vị đi qua bản sao 80 chữ số này, chỉ làm tròn MỘT lần (HALF_UP 4 số) khi ghi.
 * Số lượng (≤ 18 chữ số, 3 số lẻ) cộng/trừ bằng Prisma.Decimal là chính xác.
 */
const Money = Prisma.Decimal.clone({ precision: 80, rounding: Prisma.Decimal.ROUND_HALF_UP });
type MoneyDec = InstanceType<typeof Money>;
const mul = (a: Dec, b: Dec): MoneyDec => new Money(a.toString()).times(b.toString());

/** Giá đơn vị = tổng tiền / số lượng, làm tròn HALF_UP 4 chữ số (Decimal(18,4)). */
export function unitCostOf(total: Prisma.Decimal.Value, qty: Prisma.Decimal.Value): Dec {
  const v = new Money(total.toString()).div(qty.toString()).toDecimalPlaces(4, Money.ROUND_HALF_UP);
  return new Prisma.Decimal(v.toFixed(4));
}

const ZERO = new Prisma.Decimal(0);

interface InEvent { kind: "in"; at: Date; id: number; qty: Dec; unitCost: Dec; costRefType: StockDocType | null; costRefId: number | null }
interface OutEvent { kind: "out"; at: Date; id: number; qty: Dec }
type Ev = InEvent | OutEvent;

// Cùng thời điểm: nhập TRƯỚC xuất; cùng loại: theo id (lớp: id lớp; xuất: id dòng sổ) — D-7
const order = (a: Ev, b: Ev) =>
  a.at.getTime() - b.at.getTime() || (a.kind === "in" ? 0 : 1) - (b.kind === "in" ? 0 : 1) || a.id - b.id;

/** `costRefType/costRefId` ≠ null ⇔ lớp phụ thuộc (trả hàng / thành phẩm) — xem quy tắc chống chu trình ở `take`. */
interface Avail { layerId: number; remaining: Dec; orig: Dec; unitCost: Dec; costRefType: StockDocType | null; costRefId: number | null }
interface OutRef { id: number; at: Date; docType: StockDocType; docLineId: number; qtyOut: Dec; unitCostOut: Dec; qtyProvisional: Dec }
interface Acc { qty: Dec; cost: MoneyDec }

export interface TouchedLine { docType: StockDocType; docLineId: number }
export interface ReplayResult { touched: TouchedLine[]; eventCount: number }

/**
 * Tính lại chuỗi FIFO của 1 mã hàng từ `fromAt` trở đi. LÀ THUẬT TOÁN DUY NHẤT tính consumption/giá vốn:
 * bán ở đuôi, sửa/hủy giữa chuỗi, khôi phục, nhập bù đơn treo, đổi giá lô đều đi qua đây.
 * Yêu cầu: đã khoá advisory lock mã hàng trong transaction.
 *
 * Tính đúng của tính lại TỪNG PHẦN (== mô phỏng từ đầu): trạng thái tại `fromAt` gồm (a) lớp trước `fromAt`
 * còn hàng sau khi gỡ mọi consumption của lệnh xuất ≥ `fromAt`, (b) hàng đợi đơn treo = lệnh xuất trước
 * `fromAt` còn thiếu hàng sau khi gỡ mọi consumption vào lớp ≥ `fromAt`. Consumption (xuất < fromAt, lớp <
 * fromAt) chỉ phụ thuộc sự kiện < fromAt nên giữ nguyên. Người gọi phải chọn `fromAt` ≤ mọi sự kiện bị đổi —
 * kể cả lệnh xuất đã ăn lớp bị xoá (removeDocument làm việc đó).
 * Quy tắc chống chu trình (xem `take`): lớp phụ thuộc không cấp hàng cho chính dòng gốc của nó.
 */
export async function replayProduct(ctx: EngineCtx, productId: number, fromAt: Date): Promise<ReplayResult> {
  assertLocked(ctx, productId);
  const { tx } = ctx;
  const periodId = ctx.period.id;

  // 1) Phạm vi
  const scopeLayers = await tx.costLayer.findMany({
    where: { periodId, productId, at: { gte: fromAt } },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  });
  const scopeOuts = await tx.stockLedger.findMany({
    where: { periodId, productId, qtyOut: { gt: 0 }, at: { gte: fromAt } },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  });
  const eventCount = scopeLayers.length + scopeOuts.length;
  if (ctx.mode === "inline" && eventCount > ctx.inlineLimit) throw new ReplayTooLargeError(productId, eventCount);

  const layerIds = scopeLayers.map((l) => l.id);
  const outIds = scopeOuts.map((o) => o.id);
  const scopeOutSet = new Set(outIds);

  // 2) Gỡ consumption bị ảnh hưởng (lệnh xuất trong phạm vi HOẶC lớp trong phạm vi)
  const hit = layerIds.length || outIds.length
    ? await tx.costConsumption.findMany({
        where: { OR: [{ ledgerId: { in: outIds } }, { layerId: { in: layerIds } }] },
        select: { id: true, ledgerId: true, layerId: true },
      })
    : [];
  // Lệnh xuất CŨ (trước fromAt) vừa mất consumption vì lớp của nó nằm trong phạm vi → quay lại hàng đợi
  const earlierIds = [...new Set(hit.map((h) => h.ledgerId).filter((id) => !scopeOutSet.has(id)))];
  if (hit.length) await tx.costConsumption.deleteMany({ where: { id: { in: hit.map((h) => h.id) } } });

  // 3) Khôi phục qty_remaining của các lớp bị đụng
  await restoreLayerRemaining(tx, [...layerIds, ...hit.map((h) => h.layerId)]);

  // 4) Trạng thái đầu: lớp còn hàng trước fromAt (FIFO theo (at, id))
  const open = await tx.costLayer.findMany({
    where: { periodId, productId, at: { lt: fromAt }, qtyRemaining: { gt: 0 } },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  });
  const avail: Avail[] = open.map((l) => ({
    layerId: l.id, remaining: l.qtyRemaining, orig: l.qtyRemaining, unitCost: l.unitCost, costRefType: l.costRefType, costRefId: l.costRefId,
  }));

  // 5) Hàng đợi đơn treo CŨ: lệnh xuất trước fromAt còn thiếu hàng (đang treo, hoặc vừa mất consumption ở bước 2)
  const pendingRows = await tx.stockLedger.findMany({
    where: {
      periodId, productId, qtyOut: { gt: 0 }, at: { lt: fromAt },
      OR: [{ qtyProvisional: { gt: 0 } }, ...(earlierIds.length ? [{ id: { in: earlierIds } }] : [])],
    },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  });
  const pendingCons = pendingRows.length
    ? await tx.costConsumption.findMany({
        where: { ledgerId: { in: pendingRows.map((p) => p.id) } },
        select: { ledgerId: true, qty: true, unitCost: true },
      })
    : [];

  const refs = new Map<number, OutRef>();
  const acc = new Map<number, Acc>();
  const addAcc = (outId: number, qty: Dec, unitCost: Dec) => {
    const a = acc.get(outId) ?? { qty: ZERO, cost: new Money(0) };
    acc.set(outId, { qty: a.qty.plus(qty), cost: a.cost.plus(mul(qty, unitCost)) });
  };
  for (const c of pendingCons) addAcc(c.ledgerId, c.qty, c.unitCost);

  const shortfalls: { id: number; missing: Dec }[] = [];
  for (const p of pendingRows) {
    // Luôn đưa vào refs (để sửa cả cờ treo lỗi thời nếu có); chỉ vào hàng đợi khi thật sự còn thiếu
    refs.set(p.id, { id: p.id, at: p.at, docType: p.docType, docLineId: p.docLineId, qtyOut: p.qtyOut, unitCostOut: p.unitCostOut, qtyProvisional: p.qtyProvisional });
    const missing = p.qtyOut.minus(acc.get(p.id)?.qty ?? ZERO);
    if (missing.gt(0)) shortfalls.push({ id: p.id, missing });
  }

  // 6) Mô phỏng theo thời gian
  for (const o of scopeOuts) {
    refs.set(o.id, { id: o.id, at: o.at, docType: o.docType, docLineId: o.docLineId, qtyOut: o.qtyOut, unitCostOut: o.unitCostOut, qtyProvisional: o.qtyProvisional });
  }
  const events: Ev[] = [
    ...scopeLayers.map((l): Ev => ({ kind: "in", at: l.at, id: l.id, qty: l.qtyIn, unitCost: l.unitCost, costRefType: l.costRefType, costRefId: l.costRefId })),
    ...scopeOuts.map((o): Ev => ({ kind: "out", at: o.at, id: o.id, qty: o.qtyOut })),
  ].sort(order);

  const newCons: Prisma.CostConsumptionCreateManyInput[] = [];
  let head = 0;

  /**
   * Lệnh `outId` ăn lớp cũ nhất còn hàng; trả phần CÒN THIẾU.
   *
   * QUY TẮC CHỐNG CHU TRÌNH (spec 3.3 × 3.4): lớp PHỤ THUỘC (costRef) KHÔNG BAO GIỜ cấp hàng cho chính dòng gốc
   * của nó (dòng sổ có docType/docLineId = costRefType/costRefId) — kể cả khi dòng gốc đang treo.
   * Lý do: trả lại hàng mà chính đơn đó chưa thực giao (phần treo) không tạo ra tồn thật cho đơn đó; giá lớp trả =
   * giá dòng gốc đo KHÔNG gồm phần do chính lớp trả cấp → đồ thị phụ thuộc giá không có cạnh tự vòng, flush hội tụ.
   * (Nếu cho phép: x = round4((A + r·x)/q) chỉ co r/q mỗi vòng → hàng nghìn vòng, dừng ở một điểm trong dải điểm
   * bất động do làm tròn → giá phụ thuộc lịch sử.) Lớp đó vẫn cấp hàng bình thường cho MỌI dòng khác.
   */
  const take = (outId: number, need: Dec): Dec => {
    const ref = refs.get(outId)!;
    while (head < avail.length && avail[head]!.remaining.lte(0)) head++;
    for (let i = head; need.gt(0) && i < avail.length; i++) {
      const l = avail[i]!;
      if (l.remaining.lte(0)) continue;
      if (l.costRefType === ref.docType && l.costRefId === ref.docLineId) continue; // lớp của chính dòng gốc
      const q = Prisma.Decimal.min(need, l.remaining);
      l.remaining = l.remaining.minus(q);
      need = need.minus(q);
      newCons.push({ layerId: l.layerId, ledgerId: outId, docType: ref.docType, docLineId: ref.docLineId, qty: q, unitCost: l.unitCost });
      addAcc(outId, q, l.unitCost);
    }
    while (head < avail.length && avail[head]!.remaining.lte(0)) head++;
    return need;
  };
  /**
   * Đơn treo được nuốt theo thứ tự CŨ → MỚI mỗi khi có hàng (spec 3.3). Duyệt HẾT hàng đợi: một đơn có thể không
   * dùng được phần hàng còn lại (vì đó là lớp của chính nó) nhưng đơn sau thì dùng được.
   */
  const drain = () => {
    for (let k = 0; k < shortfalls.length && head < avail.length; ) {
      const s = shortfalls[k]!;
      s.missing = take(s.id, s.missing);
      if (s.missing.lte(0)) shortfalls.splice(k, 1);
      else k++;
    }
  };

  // Phòng thủ: ở trạng thái nhất quán, đơn treo cũ chỉ cùng tồn tại với lớp cũ còn hàng của CHÍNH nó → no-op
  drain();
  for (const ev of events) {
    if (ev.kind === "in") {
      avail.push({ layerId: ev.id, remaining: ev.qty, orig: ev.qty, unitCost: ev.unitCost, costRefType: ev.costRefType, costRefId: ev.costRefId });
      drain();
    } else {
      const left = take(ev.id, ev.qty);
      if (left.gt(0)) shortfalls.push({ id: ev.id, missing: left });
    }
  }

  // 7) Ghi kết quả
  if (newCons.length) await tx.costConsumption.createMany({ data: newCons });
  // PERF(Task 9): 1 UPDATE mỗi lớp đổi — gộp thành 1 UPDATE … FROM (VALUES …) nếu đo thấy chậm
  for (const l of avail) {
    if (!l.remaining.equals(l.orig)) await tx.costLayer.update({ where: { id: l.layerId }, data: { qtyRemaining: l.remaining } });
  }
  const estimates = new Map<number, Dec>();
  const estimateAt = async (at: Date) => {
    const k = at.getTime();
    let v = estimates.get(k);
    if (!v) { v = await estimateCost(tx, periodId, productId, at); estimates.set(k, v); }
    return v;
  };
  const touched: TouchedLine[] = [];
  for (const ref of refs.values()) {
    const a = acc.get(ref.id) ?? { qty: ZERO, cost: new Money(0) };
    const missing = ref.qtyOut.minus(a.qty);
    let total = a.cost;
    if (missing.gt(0)) total = total.plus(mul(missing, await estimateAt(ref.at)));
    const unitCostOut = unitCostOf(total, ref.qtyOut);
    if (!unitCostOut.equals(ref.unitCostOut) || !missing.equals(ref.qtyProvisional)) {
      await tx.stockLedger.update({ where: { id: ref.id }, data: { unitCostOut, qtyProvisional: missing } });
    }
    touched.push({ docType: ref.docType, docLineId: ref.docLineId });
  }
  return { touched, eventCount };
}
