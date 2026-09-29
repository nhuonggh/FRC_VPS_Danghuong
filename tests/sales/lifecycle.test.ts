import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { createDeliveryNote } from "@/server/delivery/service";
import { deliveryNoteSchema } from "@/server/delivery/schemas";
import { cancelSaleOrderTx, editSaleOrderTx, restoreSaleOrderTx } from "@/server/sales/lifecycle";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { prisma, resetDb } from "../helpers/db";
import { makeBomVersion, makePartner, makeProcessingType, makeProduct } from "../helpers/factories";
import { assertLedgerBalanced, buy, engine, newWorld, type World } from "../inventory/helpers";

const NOW = new Date("2026-09-15T03:00:00Z"); // 10:00 ICT 15/09
const PERMS = ["order.create", "order.edit", "order.cancel", "order.restore", "sale_price.view", "order.edit_price", "partner.view_all"];
let w: World; let actor: Actor; let customer: { id: number }; let n = 0;

type L = { id?: number; productId?: number; qty: number; price?: number; discountNow?: number; discountAccum?: number; processingTypeId?: number | null; unit?: string };
const body = (lines: L[], over: Record<string, unknown> = {}) => saleOrderSchema.parse({
  partnerId: customer.id, date: "2026-09-10", expectedDeliveryDate: "2026-09-20", note: "", ...over,
  lines: lines.map((l) => ({ id: l.id, productId: l.productId ?? w.p.id, unit: l.unit ?? w.p.baseUnit, qty: l.qty, salePrice: l.price ?? 30_000, discountNow: l.discountNow ?? 0, discountAccum: l.discountAccum ?? 0, processingTypeId: l.processingTypeId ?? null })),
});
const make = async (lines: L[], over: Record<string, unknown> = {}, who: Actor = actor) => {
  const o = await createSaleOrderIdempotent(prisma, who, `k-${++n}`, body(lines, over), NOW);
  const ls = await prisma.saleOrderLine.findMany({ where: { orderId: o.id }, orderBy: { id: "asc" } });
  return { ...o, lines: ls };
};
const cost = async (orderId: number) => (await prisma.saleOrderLine.findMany({ where: { orderId }, orderBy: { id: "asc" } })).map((l) => l.unitCostFifo.toString());
const balance = async (orderId: number) => {
  const r = await prisma.discountLedger.aggregate({ where: { docId: orderId, docType: { startsWith: "SALE" } }, _sum: { amountIn: true, amountOut: true } });
  return (r._sum.amountIn ?? new Prisma.Decimal(0)).minus(r._sum.amountOut ?? 0).toString();
};
const edit = (id: number, lines: L[], over: Record<string, unknown> = {}, who: Actor = actor) => editSaleOrderTx(prisma, who, id, body(lines, over), NOW);

/** Kho: 50@10.000 (01/09) rồi 100@12.000 (05/09). Đơn A ngày 03/09 bán 30; đơn B ngày 10/09 bán 60. */
async function chain() {
  const p = w.p.id; const run = engine(w);
  await run([p], (ctx) => buy(ctx, p, 50, 10_000, new Date("2026-09-01T03:00:00Z"), 1));
  await run([p], (ctx) => buy(ctx, p, 100, 12_000, new Date("2026-09-05T03:00:00Z"), 2));
  const A = await make([{ qty: 30, discountAccum: 10_000 }], { date: "2026-09-03", expectedDeliveryDate: "2026-09-03" });
  const B = await make([{ qty: 60 }], { date: "2026-09-10" });
  return { A, B };
}

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(PERMS) };
  customer = await makePartner({ isCustomer: true });
});

describe("chuỗi giá vốn ban đầu", () => {
  it("A=30@10.000; B = 20@10.000 + 40@12.000 = 11.333,3333", async () => {
    const { A, B } = await chain();
    expect(await cost(A.id)).toEqual(["10000"]);
    expect(await cost(B.id)).toEqual(["11333.3333"]);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });
});

describe("sửa đơn GIỮA chuỗi (spec 3.7 [R])", () => {
  it("giảm A từ 30 xuống 10 ⇒ B ăn nhiều lô rẻ hơn: 40@10.000 + 20@12.000 = 10.666,6667; sổ cân", async () => {
    const { A, B } = await chain();
    await edit(A.id, [{ id: A.lines[0]!.id, qty: 10, discountAccum: 10_000 }], { date: "2026-09-03", expectedDeliveryDate: "2026-09-03" });
    expect(await cost(A.id)).toEqual(["10000"]);
    expect(await cost(B.id)).toEqual(["10666.6667"]);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("giữ nguyên `at` khi không đổi ngày và giữ `seq` của dòng (vị trí trong chuỗi không xê dịch)", async () => {
    const { A } = await chain();
    const before = await prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE", docId: A.id } });
    await edit(A.id, [{ id: A.lines[0]!.id, qty: 12, discountAccum: 10_000 }], { date: "2026-09-03", expectedDeliveryDate: "2026-09-03" });
    const after = await prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE", docId: A.id } });
    expect(after.at.getTime()).toBe(before.at.getTime());
    expect(after.seq).toBe(before.seq);
    const issue = await prisma.saleLineIssue.findFirstOrThrow({ where: { orderLineId: A.lines[0]!.id } });
    expect(issue.seq).toBe(after.seq); // seq lưu ở dòng đơn luôn khớp sổ kho
  });

  it("thêm dòng mới, xoá dòng cũ, đổi khách: kho và chi tiết đúng; dòng bị xoá không để rác trong sổ kho", async () => {
    const { A } = await chain();
    const p2 = await makeProduct(); await engine(w)([p2.id], (ctx) => buy(ctx, p2.id, 10, 5_000, new Date("2026-09-01T03:00:00Z"), 3));
    const other = await makePartner({ isCustomer: true });
    await edit(A.id, [{ productId: p2.id, unit: p2.baseUnit, qty: 4, price: 9_000 }], { date: "2026-09-03", expectedDeliveryDate: "2026-09-03", partnerId: other.id });
    const lines = await prisma.saleOrderLine.findMany({ where: { orderId: A.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0]!.productId).toBe(p2.id);
    expect(await prisma.stockLedger.count({ where: { docType: "SALE", docId: A.id, productId: w.p.id } })).toBe(0);
    expect((await prisma.saleOrder.findUniqueOrThrow({ where: { id: A.id } })).partnerId).toBe(other.id);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("chiết khấu tích lũy sửa theo hiệu số; xoá dòng để lại lịch sử, số dư về 0", async () => {
    const { A } = await chain();
    expect(await balance(A.id)).toBe("10000");
    await edit(A.id, [{ id: A.lines[0]!.id, qty: 30, discountAccum: 4_000 }], { date: "2026-09-03", expectedDeliveryDate: "2026-09-03" });
    expect(await balance(A.id)).toBe("4000");
    await edit(A.id, [{ qty: 5, discountAccum: 0 }], { date: "2026-09-03", expectedDeliveryDate: "2026-09-03" }); // xoá dòng cũ, thêm dòng mới
    expect(await balance(A.id)).toBe("0");
    const rows = await prisma.discountLedger.findMany({ where: { docId: A.id }, orderBy: { id: "asc" } });
    expect(rows.length).toBeGreaterThanOrEqual(3); // dòng gốc + các dòng điều chỉnh, không xoá lịch sử
  });

  it("đơn thuộc kỳ khác kỳ đang mở ⇒ bị chặn; không ghi gì", async () => {
    const { A } = await chain();
    const closed = await prisma.period.create({ data: { name: "Kỳ đã đóng", status: "CLOSED", isOpen: null, closedAt: new Date("2026-08-31T00:00:00Z") } });
    await prisma.saleOrder.update({ where: { id: A.id }, data: { periodId: closed.id } });
    await expect(edit(A.id, [{ id: A.lines[0]!.id, qty: 1 }], { date: "2026-09-03", expectedDeliveryDate: "2026-09-03" })).rejects.toThrow();
    await expect(cancelSaleOrderTx(prisma, actor, A.id, "x")).rejects.toThrow();
    expect((await prisma.saleOrderLine.findUniqueOrThrow({ where: { id: A.lines[0]!.id } })).qty.toString()).toBe("30");
  });

  it("thiếu order.edit_price: dòng giữ nguyên giá được sửa SL, đổi giá thì bị chặn", async () => {
    const { A } = await chain();
    const seller: Actor = { userId: w.userId, perms: new Set(["order.edit", "sale_price.view", "partner.view_all"]) };
    const keep = { date: "2026-09-03", expectedDeliveryDate: "2026-09-03" };
    await expect(edit(A.id, [{ id: A.lines[0]!.id, qty: 20, discountAccum: 10_000 }], keep, seller)).resolves.toBeTruthy();
    await expect(edit(A.id, [{ id: A.lines[0]!.id, qty: 20, price: 1, discountAccum: 0 }], keep, seller)).rejects.toMatchObject({ status: 403 });
  });
});

describe("hủy và khôi phục (spec 3.7 [R])", () => {
  it("hủy A ⇒ hoàn kho, B = 50@10.000 + 10@12.000 = 10.333,3333; khôi phục ⇒ B về 11.333,3333, A về 10.000 đúng vị trí", async () => {
    const { A, B } = await chain();
    const seqBefore = (await prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE", docId: A.id } })).seq;
    await cancelSaleOrderTx(prisma, actor, A.id, "Khách đổi ý");
    expect(await prisma.stockLedger.count({ where: { docType: "SALE", docId: A.id } })).toBe(0);
    expect(await cost(B.id)).toEqual(["10333.3333"]);
    const cancelled = await prisma.saleOrder.findUniqueOrThrow({ where: { id: A.id } });
    expect(cancelled).toMatchObject({ isCancelled: true, cancelReason: "Khách đổi ý", cancelledBy: w.userId });
    expect(await balance(A.id)).toBe("0"); // chiết khấu tích lũy được đảo
    await assertLedgerBalanced(w.p.id, w.periodId);

    await restoreSaleOrderTx(prisma, actor, A.id);
    expect(await cost(A.id)).toEqual(["10000"]);
    expect(await cost(B.id)).toEqual(["11333.3333"]);
    const back = await prisma.stockLedger.findFirstOrThrow({ where: { docType: "SALE", docId: A.id } });
    expect(back.seq).toBe(seqBefore);
    expect(await balance(A.id)).toBe("10000");
    expect((await prisma.saleOrder.findUniqueOrThrow({ where: { id: A.id } })).isCancelled).toBe(false);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("khôi phục đơn MUỘN NHẤT khi tồn đã bị đơn khác dùng ⇒ thành đơn treo; khôi phục đơn SỚM hơn thì lấy lại hàng và đẩy phần thiếu sang đơn muộn hơn", async () => {
    const { A, B } = await chain();
    await cancelSaleOrderTx(prisma, actor, B.id, "x"); // B (10/09) rời chuỗi
    await make([{ qty: 100 }], { date: "2026-09-09" }); // C (09/09) ăn 100 ⇒ còn 150 − 30 − 100 = 20
    await restoreSaleOrderTx(prisma, actor, B.id); // B cần 60, chỉ còn 20 ⇒ treo 40
    const b = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: B.id } });
    expect(b.isProvisional).toBe(true);
    expect((await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: A.id } })).isProvisional).toBe(false);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("hủy rồi khôi phục đơn SỚM: đơn muộn hơn chịu phần thiếu, đơn được khôi phục vẫn đủ hàng", async () => {
    const { A, B } = await chain();
    await cancelSaleOrderTx(prisma, actor, A.id, "x");
    const C = await make([{ qty: 90 }], { date: "2026-09-11" }); // B 60 + C 90 = 150 (đủ)
    await restoreSaleOrderTx(prisma, actor, A.id); // A (03/09) cần 30 ⇒ tổng 180 > 150 ⇒ đơn muộn nhất (C) thiếu 30
    expect((await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: A.id } })).isProvisional).toBe(false);
    expect((await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: C.id } })).isProvisional).toBe(true);
    expect((await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: B.id } })).isProvisional).toBe(false);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });

  it("chặn hủy khi còn phiếu giao (đã ghi công nợ); hủy phiếu giao rồi hủy được", async () => {
    const { A } = await chain();
    const note = await prisma.$transaction((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId: A.id, date: "2026-09-03", note: "", lines: [{ orderLineId: A.lines[0]!.id, qty: 5 }] }), NOW));
    await expect(cancelSaleOrderTx(prisma, actor, A.id, "x")).rejects.toMatchObject({ status: 409, code: "HAS_DELIVERY" });
    expect(await prisma.stockLedger.count({ where: { docType: "SALE", docId: A.id } })).toBe(1);
    const { cancelDeliveryNote } = await import("@/server/delivery/service");
    await prisma.$transaction((t) => cancelDeliveryNote(t, actor, note.id));
    await expect(cancelSaleOrderTx(prisma, actor, A.id, "x")).resolves.not.toThrow();
  });

  it("hủy hai lần ⇒ 409; khôi phục đơn chưa hủy ⇒ 409; thiếu quyền ⇒ 403", async () => {
    const { A } = await chain();
    await expect(restoreSaleOrderTx(prisma, actor, A.id)).rejects.toMatchObject({ status: 409 });
    await cancelSaleOrderTx(prisma, actor, A.id, "x");
    await expect(cancelSaleOrderTx(prisma, actor, A.id, "x")).rejects.toMatchObject({ status: 409 });
    await expect(restoreSaleOrderTx(prisma, { userId: w.userId, perms: new Set(["order.cancel"]) }, A.id)).rejects.toThrow();
    await expect(cancelSaleOrderTx(prisma, { userId: w.userId, perms: new Set(["order.restore"]) }, A.id)).rejects.toThrow();
  });

  it("đơn đã hủy không sửa được", async () => {
    const { A } = await chain();
    await cancelSaleOrderTx(prisma, actor, A.id, "x");
    await expect(edit(A.id, [{ id: A.lines[0]!.id, qty: 1 }], { date: "2026-09-03" })).rejects.toThrow(/đã hủy/);
  });
});

describe("sửa đơn đã giao một phần", () => {
  it("không giảm SL dưới số đã giao, không xoá dòng đã giao; đổi giá ⇒ công nợ của phiếu giao được ghi lại", async () => {
    const { A } = await chain();
    const keep = { date: "2026-09-03", expectedDeliveryDate: "2026-09-03" };
    await prisma.$transaction((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId: A.id, date: "2026-09-03", note: "", lines: [{ orderLineId: A.lines[0]!.id, qty: 10 }] }), NOW));
    expect((await prisma.partnerLedger.findFirstOrThrow({ where: { docType: "DELIVERY" } })).debit.toString()).toBe("300000"); // 10 × 30.000
    await expect(edit(A.id, [{ id: A.lines[0]!.id, qty: 8 }], keep)).rejects.toThrow(/đã giao 10/);
    await expect(edit(A.id, [{ qty: 8 }], keep)).rejects.toThrow(/đã giao/); // bỏ dòng đã giao
    await expect(edit(A.id, [{ id: A.lines[0]!.id, qty: 30, unit: "kg" }], keep)).rejects.toThrow();
    await edit(A.id, [{ id: A.lines[0]!.id, qty: 30, price: 40_000, discountAccum: 10_000 }], keep);
    expect((await prisma.partnerLedger.findFirstOrThrow({ where: { docType: "DELIVERY" } })).debit.toString()).toBe("400000"); // 10 × 40.000
    await expect(edit(A.id, [{ id: A.lines[0]!.id, qty: 30 }], { ...keep, partnerId: (await makePartner({ isCustomer: true })).id })).rejects.toThrow(/không đổi khách/);
  });
});

describe("đồng thời", () => {
  it("hai người sửa cùng một đơn cùng lúc: kết quả tuần tự, sổ vẫn cân", async () => {
    const { A } = await chain();
    const keep = { date: "2026-09-03", expectedDeliveryDate: "2026-09-03" };
    const res = await Promise.allSettled([
      edit(A.id, [{ id: A.lines[0]!.id, qty: 11, discountAccum: 10_000 }], keep), edit(A.id, [{ id: A.lines[0]!.id, qty: 12, discountAccum: 10_000 }], keep),
    ]);
    expect(res.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    const qty = Number((await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: A.id } })).qty);
    expect([11, 12]).toContain(qty);
    expect(await prisma.stockLedger.count({ where: { docType: "SALE", docId: A.id } })).toBe(1);
    await assertLedgerBalanced(w.p.id, w.periodId);
  });
});

describe("BOM ghim phiên bản khi sửa", () => {
  it("dòng không đổi mã/kiểu gia công giữ bomVersionId cũ dù đổi ngày khiến BOM mới có hiệu lực", async () => {
    const fg = await makeProduct({ kind: "THANH_PHAM" }); const m1 = await makeProduct({ kind: "NVL" });
    const pt = await makeProcessingType();
    const v1 = await makeBomVersion({ productId: fg.id, processingTypeId: pt.id, createdBy: w.userId, validFrom: "2026-09-01", lines: [{ materialProductId: m1.id, qtyPerUnit: "1" }] });
    const v2 = await makeBomVersion({ productId: fg.id, processingTypeId: pt.id, createdBy: w.userId, validFrom: "2026-09-12", lines: [{ materialProductId: m1.id, qtyPerUnit: "3" }] });
    await engine(w)([m1.id], (ctx) => buy(ctx, m1.id, 1000, 100, new Date("2026-09-01T03:00:00Z"), 1));
    const o = await make([{ productId: fg.id, unit: fg.baseUnit, qty: 10, processingTypeId: pt.id }], { date: "2026-09-10" });
    expect(o.lines[0]!.bomVersionId).toBe(v1.id);
    await edit(o.id, [{ id: o.lines[0]!.id, productId: fg.id, unit: fg.baseUnit, qty: 10, processingTypeId: pt.id }], { date: "2026-09-13" }); // ngày mới ≥ hiệu lực v2
    const line = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: o.id } });
    expect(line.bomVersionId).toBe(v1.id); // ghim v1
    expect((await prisma.saleLineIssue.findFirstOrThrow({ where: { orderLineId: line.id } })).qtyBase.toString()).toBe("10"); // 1 × 10, không phải 3 × 10
    // Dòng MỚI cùng điều kiện dùng BOM hiệu lực theo ngày (v2)
    await edit(o.id, [{ id: o.lines[0]!.id, productId: fg.id, unit: fg.baseUnit, qty: 10, processingTypeId: pt.id }, { productId: fg.id, unit: fg.baseUnit, qty: 1, processingTypeId: pt.id }], { date: "2026-09-13" });
    const fresh = await prisma.saleOrderLine.findMany({ where: { orderId: o.id }, orderBy: { id: "asc" } });
    expect(fresh.map((l) => l.bomVersionId)).toEqual([v1.id, v2.id]);
  });
});
