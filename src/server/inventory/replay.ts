import { Prisma, type StockDocType } from "@prisma/client";
import { ReplayTooLargeError } from "./errors";
import { assertDerivedAfterSource, restoreLayerRemaining } from "./layers";
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

/** Lớp trong mô phỏng. `derived` ⇔ costRefType ≠ null (trả hàng / thành phẩm). */
interface Avail {
  layerId: number; at: Date; remaining: Dec; orig: Dec; unitCost: Dec; origCost: Dec;
  derived: boolean; costRefType: StockDocType | null; costRefId: number | null; costRefQty: Dec | null;
}
interface InEvent { kind: "in"; at: Date; id: number; layer: Avail }
interface OutEvent { kind: "out"; at: Date; id: number; qty: Dec }
type Ev = InEvent | OutEvent;

// Cùng thời điểm: nhập TRƯỚC xuất; cùng loại: theo id (lớp: id lớp; xuất: id dòng sổ) — D-7
const order = (a: Ev, b: Ev) =>
  a.at.getTime() - b.at.getTime() || (a.kind === "in" ? 0 : 1) - (b.kind === "in" ? 0 : 1) || a.id - b.id;

interface OutRef { id: number; at: Date; docType: StockDocType; docLineId: number; qtyOut: Dec; unitCostOut: Dec; qtyProvisional: Dec }
interface Pick { layer: Avail; outId: number; qty: Dec }

export interface TouchedLine { docType: StockDocType; docLineId: number }
export interface ReplayResult { touched: TouchedLine[]; eventCount: number }

/**
 * Tính lại chuỗi FIFO của 1 mã hàng từ `fromAt` trở đi. LÀ THUẬT TOÁN DUY NHẤT tính consumption/giá vốn:
 * bán ở đuôi, sửa/hủy giữa chuỗi, khôi phục, nhập bù đơn treo, đổi giá lô đều đi qua đây.
 * Yêu cầu: đã khoá advisory lock mã hàng trong transaction.
 *
 * QUY TẮC LỚP PHỤ THUỘC (spec 3.3 × 3.4 — vòng sửa 2): lớp phụ thuộc (costRef: trả hàng, thành phẩm SX) KHÔNG BAO
 * GIỜ nuốt hàng đợi đơn treo — của bất kỳ dòng nào. Đơn treo chỉ được "nhập bù" bằng lớp THƯỜNG (mua, nhập đầu kỳ,
 * điều chỉnh…) có giá tự thân cố định. Lớp phụ thuộc vẫn là tồn bình thường cho lệnh xuất đến SAU nó theo (at, id).
 * Cùng với quy tắc thời gian (lớp phụ thuộc ở SAU dòng gốc — `assertDerivedAfterSource`), giá của mọi dòng chỉ phụ
 * thuộc (a) lớp ở TRƯỚC nó theo thời gian và (b) lớp thường giá cố định; giá lớp phụ thuộc chỉ phụ thuộc dòng gốc ở
 * TRƯỚC nó ⇒ đồ thị phụ thuộc giá là DAG theo thời gian, không có dải điểm bất động do làm tròn.
 * GIẢ ĐỊNH NGHIỆP VỤ (chờ khách xác nhận): hàng khách trả KHÔNG lấp lùi đơn bán âm kho trước đó; nó là tồn cho
 * đơn bán sau. Tương tự thành phẩm SX không lấp đơn bán âm phụ kiện trước đó.
 *
 * Hai pha: (1) SỐ LƯỢNG — ai ăn lớp nào bao nhiêu không phụ thuộc giá; (2) GIÁ — một lượt theo thời gian; lớp phụ
 * thuộc có dòng gốc cùng mã hàng được định giá NGAY trong lượt (dòng gốc đã được tính trước nó), nên chuỗi trả hàng
 * lồng nhau của cùng mã hội tụ trong 1 lần tính lại. Dòng gốc khác mã (thành phẩm SX) do flush/propagate lan truyền.
 *
 * Tính đúng của tính lại TỪNG PHẦN (== mô phỏng từ đầu): trạng thái tại `fromAt` gồm (a) lớp trước `fromAt`
 * còn hàng sau khi gỡ mọi consumption của lệnh xuất ≥ `fromAt`, (b) hàng đợi đơn treo = lệnh xuất trước
 * `fromAt` còn thiếu hàng sau khi gỡ mọi consumption vào lớp ≥ `fromAt`. Consumption (xuất < fromAt, lớp <
 * fromAt) chỉ phụ thuộc sự kiện < fromAt nên giữ nguyên. Người gọi phải chọn `fromAt` ≤ mọi sự kiện bị đổi —
 * kể cả lệnh xuất đã ăn lớp bị xoá (removeDocument làm việc đó).
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
  type LayerRow = (typeof scopeLayers)[number];
  const toAvail = (l: LayerRow, remaining: Dec): Avail => ({
    layerId: l.id, at: l.at, remaining, orig: remaining, unitCost: l.unitCost, origCost: l.unitCost,
    derived: l.costRefType !== null, costRefType: l.costRefType, costRefId: l.costRefId, costRefQty: l.costRefQty,
  });
  const open = await tx.costLayer.findMany({
    where: { periodId, productId, at: { lt: fromAt }, qtyRemaining: { gt: 0 } },
    orderBy: [{ at: "asc" }, { id: "asc" }],
  });
  const avail: Avail[] = open.map((l) => toAvail(l, l.qtyRemaining));

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
  // Consumption CŨ còn giữ của đơn treo cũ (vào lớp trước fromAt — giá lớp đó không đổi trong lần này)
  const kept = new Map<number, { qty: Dec; cost: MoneyDec }>();
  for (const c of pendingCons) {
    const k = kept.get(c.ledgerId) ?? { qty: ZERO, cost: new Money(0) };
    kept.set(c.ledgerId, { qty: k.qty.plus(c.qty), cost: k.cost.plus(mul(c.qty, c.unitCost)) });
  }

  const refs = new Map<number, OutRef>();
  const shortfalls: { id: number; missing: Dec }[] = [];
  for (const p of pendingRows) {
    // Luôn đưa vào refs (để sửa cả cờ treo lỗi thời nếu có); chỉ vào hàng đợi khi thật sự còn thiếu
    refs.set(p.id, { id: p.id, at: p.at, docType: p.docType, docLineId: p.docLineId, qtyOut: p.qtyOut, unitCostOut: p.unitCostOut, qtyProvisional: p.qtyProvisional });
    const missing = p.qtyOut.minus(kept.get(p.id)?.qty ?? ZERO);
    if (missing.gt(0)) shortfalls.push({ id: p.id, missing });
  }
  for (const o of scopeOuts) {
    refs.set(o.id, { id: o.id, at: o.at, docType: o.docType, docLineId: o.docLineId, qtyOut: o.qtyOut, unitCostOut: o.unitCostOut, qtyProvisional: o.qtyProvisional });
  }
  const events: Ev[] = [
    ...scopeLayers.map((l): Ev => ({ kind: "in", at: l.at, id: l.id, layer: toAvail(l, l.qtyIn) })),
    ...scopeOuts.map((o): Ev => ({ kind: "out", at: o.at, id: o.id, qty: o.qtyOut })),
  ].sort(order);

  // ── Pha 1: SỐ LƯỢNG ──
  const picks = new Map<number, Pick[]>();
  let head = 0;
  /** Lệnh `outId` ăn lớp cũ nhất còn hàng (`plainOnly`: bỏ qua lớp phụ thuộc); trả phần CÒN THIẾU. */
  const take = (outId: number, need: Dec, plainOnly: boolean): Dec => {
    while (head < avail.length && avail[head]!.remaining.lte(0)) head++;
    for (let i = head; need.gt(0) && i < avail.length; i++) {
      const l = avail[i]!;
      if (l.remaining.lte(0) || (plainOnly && l.derived)) continue;
      const q = Prisma.Decimal.min(need, l.remaining);
      l.remaining = l.remaining.minus(q);
      need = need.minus(q);
      const list = picks.get(outId) ?? [];
      list.push({ layer: l, outId, qty: q });
      picks.set(outId, list);
    }
    while (head < avail.length && avail[head]!.remaining.lte(0)) head++;
    return need;
  };
  /** Nhập bù (spec 3.3): đơn treo được nuốt CŨ → MỚI, CHỈ bằng lớp thường. */
  const drain = () => {
    for (let k = 0; k < shortfalls.length; ) {
      const s = shortfalls[k]!;
      s.missing = take(s.id, s.missing, true);
      if (s.missing.lte(0)) shortfalls.splice(k, 1);
      else break; // lớp thường đã cạn (không lớp thường nào còn hàng khi hàng đợi khác rỗng)
    }
  };

  drain(); // phòng thủ: ở trạng thái nhất quán không có lớp thường cũ còn hàng khi còn đơn treo → no-op
  for (const ev of events) {
    if (ev.kind === "in") {
      avail.push(ev.layer);
      if (!ev.layer.derived) drain(); // lớp phụ thuộc KHÔNG nuốt đơn treo
    } else {
      const left = take(ev.id, ev.qty, false);
      if (left.gt(0)) shortfalls.push({ id: ev.id, missing: left });
    }
  }

  // ── Pha 2: GIÁ, một lượt theo thời gian ──
  const estimates = new Map<number, Dec>();
  const estimateAt = async (at: Date) => {
    const k = at.getTime();
    let v = estimates.get(k);
    if (!v) { v = await estimateCost(tx, periodId, productId, at); estimates.set(k, v); }
    return v;
  };
  const result = new Map<number, { unitCostOut: Dec; missing: Dec }>();
  const priceOut = async (ref: OutRef) => {
    const k = kept.get(ref.id);
    let qty = k?.qty ?? ZERO;
    let total = k?.cost ?? new Money(0);
    for (const p of picks.get(ref.id) ?? []) {
      qty = qty.plus(p.qty);
      total = total.plus(mul(p.qty, p.layer.unitCost));
    }
    const missing = ref.qtyOut.minus(qty);
    if (missing.gt(0)) total = total.plus(mul(missing, await estimateAt(ref.at)));
    result.set(ref.id, { unitCostOut: unitCostOf(total, ref.qtyOut), missing });
  };
  // Đơn treo cũ trước: phần mới nuốt được chỉ từ lớp thường (giá cố định)
  for (const ref of refs.values()) if (!scopeOutSet.has(ref.id)) await priceOut(ref);

  const derivedInScope = scopeLayers.filter((l) => l.costRefType !== null);
  const sources = derivedInScope.length
    ? await tx.stockLedger.findMany({
        where: { qtyOut: { gt: 0 }, OR: derivedInScope.map((l) => ({ docType: l.costRefType!, docLineId: l.costRefId! })) },
        select: { id: true, productId: true, docType: true, docLineId: true, qtyOut: true, unitCostOut: true, at: true },
      })
    : [];
  for (const ev of events) {
    if (ev.kind === "out") { await priceOut(refs.get(ev.id)!); continue; }
    const l = ev.layer;
    if (!l.derived) continue;
    const src = sources.filter((s) => s.docType === l.costRefType && s.docLineId === l.costRefId);
    assertDerivedAfterSource({ productId, at: l.at }, src);
    // Dòng gốc chưa có dòng sổ, hoặc có dòng ở mã khác (thành phẩm SX): giá do postReceipt/propagate quản
    if (src.length === 0 || src.some((s) => s.productId !== productId) || !l.costRefQty) continue;
    let total = new Money(0);
    for (const s of src) total = total.plus(mul(s.qtyOut, result.get(s.id)?.unitCostOut ?? s.unitCostOut));
    l.unitCost = unitCostOf(total, l.costRefQty);
  }

  // ── Ghi kết quả ──
  const newCons: Prisma.CostConsumptionCreateManyInput[] = [];
  for (const [outId, list] of picks) {
    const ref = refs.get(outId)!;
    for (const p of list) newCons.push({ layerId: p.layer.layerId, ledgerId: outId, docType: ref.docType, docLineId: ref.docLineId, qty: p.qty, unitCost: p.layer.unitCost });
  }
  if (newCons.length) await tx.costConsumption.createMany({ data: newCons });
  // PERF(Task 9): 1 UPDATE mỗi lớp đổi — gộp thành 1 UPDATE … FROM (VALUES …) nếu đo thấy chậm
  for (const l of avail) {
    const data: Prisma.CostLayerUpdateInput = {};
    if (!l.remaining.equals(l.orig)) data.qtyRemaining = l.remaining;
    if (!l.unitCost.equals(l.origCost)) data.unitCost = l.unitCost;
    if (Object.keys(data).length) await tx.costLayer.update({ where: { id: l.layerId }, data });
  }
  const touched: TouchedLine[] = [];
  for (const ref of refs.values()) {
    const r = result.get(ref.id)!;
    if (!r.unitCostOut.equals(ref.unitCostOut) || !r.missing.equals(ref.qtyProvisional)) {
      await tx.stockLedger.update({ where: { id: ref.id }, data: { unitCostOut: r.unitCostOut, qtyProvisional: r.missing } });
    }
    touched.push({ docType: ref.docType, docLineId: ref.docLineId });
  }
  return { touched, eventCount };
}
