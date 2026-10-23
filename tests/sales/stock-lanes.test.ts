import { Prisma } from "@prisma/client";
import { beforeEach, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { deliveryNoteSchema } from "@/server/delivery/schemas";
import { createDeliveryNote } from "@/server/delivery/service";
import { getOnHand } from "@/server/inventory";
import { createPurchaseIdempotent } from "@/server/purchase/service";
import { returnByOrderSchema } from "@/server/returns/schemas";
import { createReturnByOrderIdempotent } from "@/server/returns/service";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { salePricing } from "@/server/sales/pricing";
import { lockIdsOf, stockProductId } from "@/server/stock-lanes";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makeProcessingType, makeProduct } from "../helpers/factories";
import { newWorld, type World } from "../inventory/helpers";

const NOW = new Date("2026-09-15T03:00:00Z");
const PERMS = ["purchase.create", "order.create", "order.view", "return.manage", "sale_price.view", "purchase_price.view", "cost.view", "order.analysis.view", "stock.view", "partner.view_all", "order.edit_price", "order.edit"];
const tx = <R,>(fn: (t: Prisma.TransactionClient) => Promise<R>) => prisma.$transaction(fn);
let w: World, actor: Actor, supplier: number, customer: number, n = 0;
let refill: { id: number }, shell: { id: number }, shellLane: { id: number }, refillLane: { id: number };

/** Một sản phẩm "Bình khí" (mã gốc = kho Mua vỏ) + kho con Đổi khí, đúng cách cấu hình ở VPS. */
beforeEach(async () => {
  await resetDb(); w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(PERMS) };
  supplier = (await makePartner({ isSupplier: true })).id;
  customer = (await makePartner({ isCustomer: true })).id;
  shell = await makeProcessingType("Mua vỏ"); refill = await makeProcessingType("Đổi khí");
  shellLane = w.p; // mã gốc = kho "Mua vỏ"
  refillLane = await makeProduct({ canSell: false, canPurchase: false });
  await prisma.productStockLane.create({ data: { productId: w.p.id, processingTypeId: refill.id, stockProductId: refillLane.id } });
});

const buy = (typeId: number | null, qty: number, price: number) => createPurchaseIdempotent(prisma, actor, `b-${++n}`, {
  partnerId: supplier, date: "2026-09-10", freightCost: 0, note: "",
  lines: [{ productId: w.p.id, unit: w.p.baseUnit, factor: 1, qty, purchasePrice: price, rollInfo: "", processingTypeId: typeId }],
});
const sell = (typeId: number | null, qty: number, price: number) => createSaleOrderIdempotent(prisma, actor, `s-${++n}`, saleOrderSchema.parse({
  partnerId: customer, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "",
  lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty, salePrice: price, discountNow: 0, discountAccum: 0, processingTypeId: typeId }],
}), NOW);
const onHand = async (id: number) => (await getOnHand(prisma, w.periodId, id)).toString();

it("stockProductId: có kho con thì trả mã kho con, không có kiểu hoặc chưa cấu hình thì trả chính sản phẩm", async () => {
  expect(await stockProductId(prisma, w.p.id, refill.id)).toBe(refillLane.id);
  expect(await stockProductId(prisma, w.p.id, shell.id)).toBe(w.p.id);
  expect(await stockProductId(prisma, w.p.id, null)).toBe(w.p.id);
  expect(await lockIdsOf(prisma, [{ productId: w.p.id, processingTypeId: refill.id }, { productId: w.p.id }])).toEqual([w.p.id, refillLane.id].sort((a, b) => a - b));
});

it("nhập theo kiểu vào đúng kho; bán theo kiểu lấy đúng giá vốn FIFO của kho đó", async () => {
  await buy(shell.id, 4, 1_500_000); await buy(refill.id, 2, 220_000);
  expect(await onHand(shellLane.id)).toBe("4"); expect(await onHand(refillLane.id)).toBe("2");
  await sell(refill.id, 1, 325_000);
  expect(await onHand(refillLane.id)).toBe("1"); expect(await onHand(shellLane.id)).toBe("4");
  const line = await prisma.saleOrderLine.findFirstOrThrow({ orderBy: { id: "desc" } });
  expect(line.unitCostFifo.toString()).toBe("220000");
  await sell(shell.id, 1, 2_300_000);
  expect((await prisma.saleOrderLine.findFirstOrThrow({ orderBy: { id: "desc" } })).unitCostFifo.toString()).toBe("1500000");
});

it("giá vốn tham khảo và tồn trên form bán lấy theo kiểu đang chọn; kiểu chưa nhập thì không có giá", async () => {
  await buy(shell.id, 4, 1_500_000); await buy(refill.id, 2, 220_000);
  const at = new Date("2026-09-20T05:00:00Z");
  const r = await salePricing(prisma, actor, customer, w.p.id, refill.id, at);
  expect(r?.onHand).toBe("2"); expect(r?.costReference?.primary?.perBase).toBe("220000");
  const s = await salePricing(prisma, actor, customer, w.p.id, shell.id, at);
  expect(s?.onHand).toBe("4"); expect(s?.costReference?.primary?.perBase).toBe("1500000");
});

it("kiểu có kho con nhưng chưa từng nhập thì không hiện giá vốn tham khảo (không mượn giá kiểu kia)", async () => {
  await buy(shell.id, 4, 1_500_000);
  const r = await salePricing(prisma, actor, customer, w.p.id, refill.id, new Date("2026-09-20T05:00:00Z"));
  expect(r?.onHand).toBe("0"); expect(r?.costReference?.primary).toBeNull();
});

it("trả hàng theo đơn đưa hàng về đúng kho con của dòng bán, giữ giá vốn dòng gốc", async () => {
  await buy(refill.id, 2, 220_000); await buy(shell.id, 4, 1_500_000);
  const order = await sell(refill.id, 2, 325_000);
  const line = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: order.id } });
  await tx((t) => createDeliveryNote(t, actor, deliveryNoteSchema.parse({ orderId: order.id, date: "2026-09-15", note: "", lines: [{ orderLineId: line.id, qty: 2 }] }), NOW));
  expect(await onHand(refillLane.id)).toBe("0");
  await createReturnByOrderIdempotent(prisma, actor, `ro-${++n}`, returnByOrderSchema.parse({ orderId: order.id, date: "2026-09-15", note: "", lines: [{ orderLineId: line.id, qty: 1 }] }), NOW);
  expect(await onHand(refillLane.id)).toBe("1"); expect(await onHand(shellLane.id)).toBe("4");
  const back = await prisma.costLayer.findFirstOrThrow({ where: { productId: refillLane.id, sourceDocType: "RETURN_IN" } });
  expect(back.unitCost.toString()).toBe("220000");
});

it("sản phẩm không cấu hình kho con chạy y như cũ dù có chọn kiểu", async () => {
  const plain = await makeProduct();
  expect(await stockProductId(prisma, plain.id, refill.id)).toBe(plain.id);
});
