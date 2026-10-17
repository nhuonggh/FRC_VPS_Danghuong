import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makePeriod, makeProduct, makeUser } from "../helpers/factories";
import { actOnOrder, createSupplierOrder, orderInclude, progress, receiveSupplierOrder } from "@/server/supplier-orders/service";
import { cancelPurchaseTx } from "@/server/purchase/service";
import { listSupplierOrders } from "@/server/supplier-orders/queries";
import { receiveOrderSchema, supplierOrderSchema } from "@/server/supplier-orders/schemas";
import type { Actor } from "@/lib/permissions/scope";
import { ictYmd } from "@/lib/time";

let actor: Actor, receiver: Actor, partnerId: number, productId: number;
const today = () => ictYmd(new Date());
const input = () => supplierOrderSchema.parse({ partnerId, date: today(), note: "", lines: [{ productId, unit: "md", factor: 1, qty: 10, purchasePrice: 100, rollInfo: "", expectedDate: "2026-01-01" }] });
async function placed(key = "order") {
  const o = await createSupplierOrder(prisma, actor, key, input());
  await actOnOrder(prisma, actor, o.id, { action: "send", reason: "", dates: [] });
  return prisma.supplierOrder.findUniqueOrThrow({ where: { id: o.id }, include: orderInclude });
}
const receipt = (lineId: number, qty: number, excessReason = "") => ({ date: today(), freightCost: 0, note: "", excessReason, lines: [{ lineId, qty, purchasePrice: 120 }] });
beforeEach(async () => {
  await resetDb();
  const creator = await makeUser(), other = await makeUser();
  actor = { userId: creator.id, perms: new Set(["purchase.view", "purchase.create", "purchase.edit", "purchase.cancel", "purchase_price.view"]) };
  receiver = { ...actor, userId: other.id };
  await makePeriod({ openedAt: new Date(Date.now() - 86400000) });
  partnerId = (await makePartner({ isSupplier: true })).id;
  productId = (await makeProduct({ baseUnit: "md", canPurchase: true })).id;
});
describe("supplier orders", () => {
  it("ordering is idempotent and does not post inventory or debt", async () => {
    const a = await createSupplierOrder(prisma, actor, "same", input());
    expect(await createSupplierOrder(prisma, actor, "same", input())).toEqual(a);
    expect(await prisma.stockLedger.count()).toBe(0);
    expect(await prisma.partnerLedger.count()).toBe(0);
    await expect(receiveSupplierOrder(prisma, receiver, a.id, "draft-receive", receipt(1, 1))).rejects.toMatchObject({ status: 409 });
  });
  it("receives in parts, notifies the original accountant, and excludes cancelled receipts", async () => {
    const o = await placed(), lineId = o.lines[0].id;
    const r = await receiveSupplierOrder(prisma, receiver, o.id, "r1", receipt(lineId, 4));
    expect(await receiveSupplierOrder(prisma, receiver, o.id, "r1", receipt(lineId, 4))).toEqual(r);
    let updated = await prisma.supplierOrder.findUniqueOrThrow({ where: { id: o.id }, include: orderInclude });
    expect(progress(updated)).toBe("PARTIAL");
    expect(updated.lines[0].receipts[0].purchase.createdBy).toBe(receiver.userId);
    expect(await prisma.supplierOrderNotice.count({ where: { userId: actor.userId } })).toBe(1);
    const filter = { q: "", status: "PARTIAL", mine: true, overdue: true, page: 1 };
    expect((await listSupplierOrders(prisma, actor, filter)).total).toBe(1);
    expect((await listSupplierOrders(prisma, receiver, filter)).total).toBe(0);
    const second = await receiveSupplierOrder(prisma, receiver, o.id, "r2", receipt(lineId, 6));
    updated = await prisma.supplierOrder.findUniqueOrThrow({ where: { id: o.id }, include: orderInclude });
    expect(progress(updated)).toBe("RECEIVED");
    await cancelPurchaseTx(prisma, actor, second.id, "Giao sai");
    updated = await prisma.supplierOrder.findUniqueOrThrow({ where: { id: o.id }, include: orderInclude });
    expect(progress(updated)).toBe("PARTIAL");
    expect((await listSupplierOrders(prisma, actor, filter)).total).toBe(1);
  });
  it("rejects excess without reason and foreign lines, and closes only with reason", async () => {
    const o = await placed();
    await expect(receiveSupplierOrder(prisma, receiver, o.id, "over", receipt(o.lines[0].id, 11))).rejects.toMatchObject({ status: 400 });
    expect(await prisma.purchase.count()).toBe(0);
    await expect(receiveSupplierOrder(prisma, receiver, o.id, "foreign", receipt(99999, 1))).rejects.toMatchObject({ status: 400 });
    await expect(actOnOrder(prisma, actor, o.id, { action: "close", reason: "", dates: [] })).rejects.toMatchObject({ status: 400 });
    await receiveSupplierOrder(prisma, receiver, o.id, "accept-over", receipt(o.lines[0].id, 11, "Đồng ý nhận thêm"));
    expect(progress(await prisma.supplierOrder.findUniqueOrThrow({ where: { id: o.id }, include: orderInclude }))).toBe("RECEIVED");
  });
  it("serializes two simultaneous receipts and prevents over-receiving", async () => {
    const o = await placed();
    const results = await Promise.allSettled([receiveSupplierOrder(prisma, actor, o.id, "concurrent-a", receipt(o.lines[0].id, 7)), receiveSupplierOrder(prisma, receiver, o.id, "concurrent-b", receipt(o.lines[0].id, 7))]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.purchase.count()).toBe(1);
  });
  it("allocates a consolidated receipt to multiple accountants' orders", async () => {
    const first = await placed("first"), second = await placed("second");
    await prisma.supplierOrder.update({ where: { id: second.id }, data: { createdBy: receiver.userId } });
    const data = receipt(first.lines[0].id, 2); data.lines.push({ lineId: second.lines[0].id, qty: 3, purchasePrice: 120 });
    await receiveSupplierOrder(prisma, actor, first.id, "combined", data);
    expect(await prisma.purchase.count()).toBe(1);
    expect(await prisma.supplierOrderNotice.count()).toBe(2);
    expect(progress(await prisma.supplierOrder.findUniqueOrThrow({ where: { id: second.id }, include: orderInclude }))).toBe("PARTIAL");
  });
  it("rejects invalid dates, duplicate allocation and malformed evidence", () => {
    expect(supplierOrderSchema.safeParse({ ...input(), date: "2026-02-30" }).success).toBe(false);
    const data = receipt(1, 2); data.lines.push(data.lines[0]);
    expect(receiveOrderSchema.safeParse(data).success).toBe(false);
    expect(supplierOrderSchema.safeParse({ ...input(), attachments: [{ name: "x", data: "data:text/html;base64,AAAA" }] }).success).toBe(false);
  });
});
