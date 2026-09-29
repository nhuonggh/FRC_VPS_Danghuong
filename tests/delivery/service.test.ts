import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { deliveryNoteSchema } from "@/server/delivery/schemas";
import { cancelDeliveryNote, createDeliveryNote, createDeliveryNoteIdempotent, deliveredValue } from "@/server/delivery/service";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { prisma, resetDb } from "../helpers/db";
import { makePartner } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

const NOW = new Date("2026-09-15T03:00:00Z");
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World; let actor: Actor; let customer: { id: number }; let n = 0;

/** Đơn 3 md × 100.000, CK trừ ngay 1 ⇒ thành tiền 299.999 (không chia hết cho 3 → kiểm làm tròn luỹ kế). */
async function makeOrder(over: { date?: string; qty?: number } = {}) {
  const qty = over.qty ?? 3;
  const input = saleOrderSchema.parse({
    partnerId: customer.id, date: over.date ?? "2026-09-15", expectedDeliveryDate: "2026-09-20", note: "",
    lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty, salePrice: 100_000, discountNow: 1, discountAccum: 0, processingTypeId: null }],
  });
  const o = await createSaleOrderIdempotent(prisma, { userId: w.userId, perms: new Set(["order.create", "sale_price.view", "order.edit_price", "partner.view_all"]) }, `o-${++n}`, input, NOW);
  const line = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: o.id } });
  return { ...o, lineId: line.id };
}
const deliver = (orderId: number, lineId: number, qty: number, date = "2026-09-15", who: Actor = actor) =>
  tx((t) => createDeliveryNote(t, who, deliveryNoteSchema.parse({ orderId, date, note: "", lines: [{ orderLineId: lineId, qty }] }), NOW));
const debits = async () => (await prisma.partnerLedger.findMany({ where: { docType: "DELIVERY" }, orderBy: { id: "asc" } })).map((r) => r.debit.toString());
const status = async (id: number) => (await prisma.saleOrder.findUniqueOrThrow({ where: { id } })).deliveryStatus;

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(["order.edit", "partner.view_all"]) };
  customer = await makePartner({ isCustomer: true });
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
});

describe("deliveredValue — làm tròn luỹ kế", () => {
  it("Σ các lần giao = thành tiền dòng, dù không chia hết", () => {
    const net = D(299_999), qty = D(3);
    const a = deliveredValue(net, qty, D(0), D(1)), b = deliveredValue(net, qty, D(1), D(1)), c = deliveredValue(net, qty, D(2), D(1));
    expect([a, b, c].map(String)).toEqual(["99999.67", "99999.66", "99999.67"]);
    expect(a.plus(b).plus(c).toString()).toBe("299999");
    expect(deliveredValue(net, qty, D(0), D(3)).toString()).toBe("299999"); // giao một lần
  });
});

describe("createDeliveryNote", () => {
  it("giao 2 lần đủ SL: công nợ ghi theo từng lần, tổng đúng thành tiền; trạng thái Giao một phần → Đã giao", async () => {
    const o = await makeOrder();
    expect(await status(o.id)).toBe("NEW");
    const first = await deliver(o.id, o.lineId, 1);
    expect(first.code).toMatch(/^PG\d{6}$/);
    expect(await status(o.id)).toBe("PARTIAL");
    await deliver(o.id, o.lineId, 2);
    expect(await status(o.id)).toBe("DELIVERED");
    const d = await debits();
    expect(d).toEqual(["99999.67", "199999.33"]);
    expect(d.reduce((s, x) => s.plus(x), D(0)).toString()).toBe("299999");
    const row = await prisma.partnerLedger.findFirstOrThrow({ where: { docType: "DELIVERY" } });
    expect(row).toMatchObject({ partnerId: customer.id });
    expect(row.credit.toString()).toBe("0");
  });

  it("giao vượt SL còn lại bị chặn kèm số còn lại; không ghi gì", async () => {
    const o = await makeOrder();
    await deliver(o.id, o.lineId, 2);
    await expect(deliver(o.id, o.lineId, 2)).rejects.toThrow(/chỉ còn 1/);
    expect(await prisma.deliveryNote.count()).toBe(1);
    expect(await debits()).toHaveLength(1);
  });

  it("hai phiếu giao đồng thời vượt tổng SL: chỉ một thành công (khoá đơn)", async () => {
    const o = await makeOrder();
    const res = await Promise.allSettled([deliver(o.id, o.lineId, 2), deliver(o.id, o.lineId, 2)]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.deliveryNote.count()).toBe(1);
  });

  it("kiểm dữ liệu: dòng không thuộc đơn, SL ≤ 0, dòng trùng, ngày trước ngày đơn, ngày tương lai, đơn đã hủy", async () => {
    const o = await makeOrder();
    const o2 = await makeOrder();
    await expect(deliver(o.id, o2.lineId, 1)).rejects.toThrow(/không thuộc đơn này/);
    expect(deliveryNoteSchema.safeParse({ orderId: 1, date: "2026-09-15", note: "", lines: [{ orderLineId: 1, qty: 0 }] }).success).toBe(false);
    expect(deliveryNoteSchema.safeParse({ orderId: 1, date: "2026-09-15", note: "", lines: [{ orderLineId: 1, qty: 1 }, { orderLineId: 1, qty: 1 }] }).success).toBe(false);
    await expect(deliver(o.id, o.lineId, 1, "2026-09-16")).rejects.toThrow(/tương lai/);
    const older = await makeOrder({ date: "2026-09-10" });
    await expect(deliver(older.id, older.lineId, 1, "2026-09-09")).rejects.toThrow(/trước ngày đơn/);
    await prisma.saleOrder.update({ where: { id: o2.id }, data: { isCancelled: true } });
    await expect(deliver(o2.id, o2.lineId, 1)).rejects.toThrow(/đã hủy/);
  });

  it("thiếu order.edit → 403; khách ngoài phạm vi → 404; đơn thuộc kỳ khác kỳ đang mở → PeriodClosed", async () => {
    const o = await makeOrder();
    await expect(deliver(o.id, o.lineId, 1, "2026-09-15", { userId: w.userId, perms: new Set(["order.view", "partner.view_all"]) })).rejects.toThrow();
    await expect(deliver(o.id, o.lineId, 1, "2026-09-15", { userId: w.userId, perms: new Set(["order.edit"]) })).rejects.toMatchObject({ status: 404 });
    const other = await prisma.period.create({ data: { name: "Kỳ đã đóng", status: "CLOSED", isOpen: null, closedAt: new Date("2026-08-31T00:00:00Z") } });
    await prisma.saleOrder.update({ where: { id: o.id }, data: { periodId: other.id } });
    await expect(deliver(o.id, o.lineId, 1)).rejects.toMatchObject({ name: "PeriodClosedError" });
    expect(await prisma.deliveryNote.count()).toBe(0);
  });

  it("idempotent: cùng key chỉ tạo một phiếu và một dòng công nợ; audit không chứa số tiền", async () => {
    const o = await makeOrder();
    const input = deliveryNoteSchema.parse({ orderId: o.id, date: "2026-09-15", note: "", lines: [{ orderLineId: o.lineId, qty: 1 }] });
    const [a, b] = await Promise.all([1, 2].map(() => createDeliveryNoteIdempotent(prisma, actor, "same", input, NOW)));
    expect(b).toEqual(a);
    expect(await prisma.deliveryNote.count()).toBe(1);
    expect(await debits()).toHaveLength(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "delivery.create" } });
    expect(JSON.stringify(audit.afterJson)).not.toMatch(/9999|debit|amount/i);
  });
});

describe("cancelDeliveryNote", () => {
  it("hủy đảo công nợ (xoá dòng sổ của phiếu) và trả trạng thái; giao lại được phần đã hủy", async () => {
    const o = await makeOrder();
    const a = await deliver(o.id, o.lineId, 1); await deliver(o.id, o.lineId, 2);
    expect(await status(o.id)).toBe("DELIVERED");
    await tx((t) => cancelDeliveryNote(t, actor, a.id));
    expect(await status(o.id)).toBe("PARTIAL");
    expect(await debits()).toEqual(["199999.33"]);
    await expect(tx((t) => cancelDeliveryNote(t, actor, a.id))).rejects.toMatchObject({ status: 409 });
    await deliver(o.id, o.lineId, 1); // phần đã hủy giao lại được
    expect(await status(o.id)).toBe("DELIVERED");
    const b = await prisma.deliveryNote.findFirstOrThrow({ where: { isCancelled: false }, orderBy: { id: "asc" } });
    await tx((t) => cancelDeliveryNote(t, actor, b.id));
    const rest = await prisma.deliveryNote.findFirstOrThrow({ where: { isCancelled: false } });
    await tx((t) => cancelDeliveryNote(t, actor, rest.id));
    expect(await status(o.id)).toBe("NEW");
    expect(await debits()).toEqual([]);
  });
});
