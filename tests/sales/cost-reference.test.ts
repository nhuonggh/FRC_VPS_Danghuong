import { beforeEach, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { makeBomVersion, makePartner, makeProcessingType, makeProduct } from "../helpers/factories";
import { newWorld, type World } from "../inventory/helpers";
import { costReference } from "@/server/sales/cost-reference";
import { createPurchaseIdempotent, cancelPurchaseTx } from "@/server/purchase/service";
import { createProductionOrderIdempotent, cancelProductionOrderTx } from "@/server/production/service";
import type { Actor } from "@/lib/permissions/scope";
import { bulkCreateReferenceCostPlans, bulkReferenceCostPlanSchema, createReferenceCostPlan, deleteReferenceCostPlan, referenceCostPlanSchema, usedReferenceCostPlanIds } from "@/server/processing/reference-cost-plans";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { getOrder, getOrderForEdit } from "@/server/sales/queries";
import { editSaleOrderTx } from "@/server/sales/lifecycle";
let w: World, actor: Actor, supplier: number, n = 0;
const at = new Date("2026-09-20T16:59:59Z");
beforeEach(async () => {
  await resetDb(); w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(["order.analysis.view", "purchase.create", "purchase.cancel", "purchase_price.view", "cost.view", "production.manage", "bom.manage"]) };
  supplier = (await makePartner({ isSupplier: true })).id;
});
const buy = (productId: number, price: number, date = "2026-09-15") => createPurchaseIdempotent(prisma, actor, `buy-${++n}`, { partnerId: supplier, date, freightCost: 0, note: "", lines: [{ productId, qty: 100, unit: "md", factor: 1, purchasePrice: price, rollInfo: "" }] });

async function plannedWorld(includeTon = true) {
  actor.perms = new Set([...actor.perms, "product.view", "product.manage", "catalog.manage", "order.create", "order.view", "partner.view_all", "sale_price.view", "order.edit_price"]);
  const type = await makeProcessingType();
  await prisma.processingType.update({ where: { id: type.id }, data: { ratio: "1.08", priceBasis: "AREA" } });
  const aux = await makeProduct({ baseUnit: "md", kind: "NVL", canUseAsMaterial: true });
  const finished = await makeProduct({ baseUnit: "md", kind: "THANH_PHAM", canProduce: true });
  await prisma.productProcessingRatio.create({ data: { productId: finished.id, processingTypeId: type.id, updatedBy: w.userId } });
  await buy(w.p.id, 100); await buy(aux.id, 50);
  await makeBomVersion({ productId: finished.id, processingTypeId: type.id, createdBy: w.userId, validFrom: "2026-09-01", lines: [
    ...(includeTon ? [{ materialProductId: w.p.id, qtyPerUnit: 2 }] : []), { materialProductId: aux.id, qtyPerUnit: "0.5" },
  ] });
  const save = (over: Record<string, unknown> = {}) => prisma.$transaction(tx => createReferenceCostPlan(tx, actor, finished.id, referenceCostPlanSchema.parse({
    processingTypeId: type.id, scope: "PRODUCT", validFrom: "2026-09-20", tonProductId: w.p.id, fixedPricePerM2: 44322,
    feePerMeter: 2000, ...over,
  }), new Date("2026-09-20T01:00:00Z")));
  return { type, aux, finished, save };
}

it("adds finished-width ton price and per-meter fee, replacing the ton already present in BOM", async () => {
  const { type, finished, save } = await plannedWorld(); await save();
  const before = await prisma.stockLedger.count();
  const ref = await costReference(prisma, actor, finished.id, type.id, at);
  expect(ref?.primary?.perBase).toBe("49892.76"); // 44322*1.08 + 0.5*50 + 2000; no extra 2*100
  expect(ref?.materials).toHaveLength(1);
  expect(ref?.components?.map(c => c.perBase)).toEqual(["47867.76", "25", "2000"]);
  expect(ref?.message).toContain("một lần");
  expect(await prisma.stockLedger.count()).toBe(before);
});

it("inherits default fee by effective date; explicit zero overrides the default", async () => {
  const { type, finished, save } = await plannedWorld();
  await save({ scope: "TYPE", tonProductId: null, fixedPricePerM2: null, feePerMeter: 2000 });
  await save({ feePerMeter: null });
  expect((await costReference(prisma, actor, finished.id, type.id, at))?.primary?.perBase).toBe("49892.76");
  await save({ validFrom: "2026-09-21", feePerMeter: 0 });
  expect((await costReference(prisma, actor, finished.id, type.id, new Date("2026-09-21T05:00:00Z")))?.primary?.perBase).toBe("47892.76");
  expect((await costReference(prisma, actor, finished.id, type.id, new Date("2026-09-19T05:00:00Z")))?.primary?.perBase).toBe("225");
});

it("uses last purchase and BOM consumption, or configured consumption when ton is absent; keeps a stock warning", async () => {
  const { type, finished, save } = await plannedWorld(false); await save({ fixedPricePerM2: null, tonQtyPerMeter: 3 });
  const ref = await costReference(prisma, actor, finished.id, type.id, at);
  expect(ref?.primary?.perBase).toBe("2325");
  expect(ref?.message).toContain("chưa có trong BOM");
});

it("does not treat missing fee, ratio or auxiliary price as zero", async () => {
  const { type, aux, finished, save } = await plannedWorld(); await save({ feePerMeter: null });
  expect((await costReference(prisma, actor, finished.id, type.id, at))?.primary?.perBase).toBeNull();
  await prisma.processingType.update({ where: { id: type.id }, data: { ratio: null } });
  expect((await costReference(prisma, actor, finished.id, type.id, at))?.message).toContain("tỷ lệ");
  await prisma.processingType.update({ where: { id: type.id }, data: { ratio: "1.08" } });
  await save({ validFrom: "2026-09-21", feePerMeter: 0 });
  const missing = await makeProduct({ baseUnit: "md", kind: "NVL" });
  await makeBomVersion({ productId: finished.id, processingTypeId: type.id, createdBy: w.userId, validFrom: "2026-09-21", lines: [{ materialProductId: missing.id, qtyPerUnit: 1 }, { materialProductId: aux.id, qtyPerUnit: 1 }] });
  await save({ validFrom: "2026-09-22", feePerMeter: 0 });
  expect((await costReference(prisma, actor, finished.id, type.id, new Date("2026-09-22T05:00:00Z")))?.primary?.perBase).toBeNull();
  expect(await costReference(prisma, { ...actor, perms: new Set(["order.analysis.view", "cost.view"]) }, finished.id, type.id, at)).toMatchObject({ primary: null });
});

it("enforces write permissions, valid dates, nonnegative fees and same-day overwrite", async () => {
  const { save } = await plannedWorld();
  expect(referenceCostPlanSchema.safeParse({}).success).toBe(false);
  await expect(save({ feePerMeter: -1 })).rejects.toThrow();
  await expect(save({ validFrom: "2026-09-19" })).rejects.toThrow("trước hôm nay");
  const original = actor.perms; actor.perms = new Set(["product.view", "cost.view", "purchase_price.view"]);
  await expect(save()).rejects.toThrow(); actor.perms = original;
  const first = await save(); await expect(save()).resolves.toEqual(first); // cùng ngày, chưa dùng → ghi đè
});

it("computes ton + fee without a BOM and never substitutes the stock purchase cost", async () => {
  const { type, finished, save } = await plannedWorld(); await save(); await buy(finished.id, 90000);
  await prisma.bomVersion.updateMany({ where: { bom: { productId: finished.id, processingTypeId: type.id } }, data: { status: "CANCELLED" } });
  const ref = await costReference(prisma, actor, finished.id, type.id, at);
  expect(ref?.primary?.perBase).not.toBeNull(); expect(ref?.primary?.perBase).not.toBe("90000");
  expect(ref?.message).toContain("không tính vật liệu phụ");
});

it("reports missing BOM when there is no BOM and no cost plan", async () => {
  const { type, finished } = await plannedWorld(); await buy(finished.id, 90000);
  await prisma.bomVersion.updateMany({ where: { bom: { productId: finished.id, processingTypeId: type.id } }, data: { status: "CANCELLED" } });
  const ref = await costReference(prisma, actor, finished.id, type.id, at, "BOM");
  expect(ref?.primary).toBeNull(); expect(ref?.message).toContain("Chưa có định mức");
});

it("preserves the order's stored estimate when future plans change and hides it without cost permissions", async () => {
  const { type, finished, save } = await plannedWorld(); await save();
  const customer = await makePartner({ isCustomer: true });
  const created = await createSaleOrderIdempotent(prisma, actor, `reference-order-${++n}`, {
    partnerId: customer.id, date: "2026-09-20", expectedDeliveryDate: "2026-09-20", note: "",
    lines: [{ productId: finished.id, processingTypeId: type.id, issueMode: "BOM", unit: "md", qty: 1, salePrice: 100000, discountNow: 0, discountAccum: 0 }],
  }, at);
  const line = await prisma.saleOrderLine.findFirstOrThrow({ where: { orderId: created.id } });
  expect(line.referenceCostSnapshot).toMatchObject({ primary: { perBase: "49892.76" } });
  await save({ validFrom: "2026-09-21", fixedPricePerM2: 50000 });
  actor.perms = new Set([...actor.perms, "order.edit"]);
  await editSaleOrderTx(prisma, actor, created.id, {
    partnerId: customer.id, date: "2026-09-21", expectedDeliveryDate: "2026-09-21", note: "Đổi số lượng",
    lines: [{ id: line.id, productId: finished.id, processingTypeId: type.id, issueMode: "BOM", unit: "md", qty: 2, salePrice: 100000, discountNow: 0, discountAccum: 0 }],
  }, new Date("2026-09-21T05:00:00Z"));
  expect((await getOrder(prisma, actor, created.id)).lines[0]?.referenceCost?.primary?.perBase).toBe("49892.76");
  expect((await getOrderForEdit(prisma, actor, created.id)).referenceCosts?.[line.id]?.reference.primary?.perBase).toBe("49892.76");
  const restricted = { ...actor, perms: new Set([...actor.perms].filter(p => p !== "cost.view")) };
  expect((await getOrder(prisma, restricted, created.id)).lines[0]?.referenceCost).toBeUndefined();
  expect((await getOrderForEdit(prisma, restricted, created.id)).referenceCosts).toBeUndefined();
});
it("same-day save overwrites an unused plan; used plans cannot be deleted or overwritten", async () => {
  const { type, finished, save } = await plannedWorld();
  const first = await save();
  const again = await save({ fixedPricePerM2: 50000 });
  expect(again.id).toBe(first.id);
  expect(await prisma.referenceCostPlan.count()).toBe(1);
  expect((await prisma.referenceCostPlan.findUniqueOrThrow({ where: { id: first.id } })).fixedPricePerM2?.toString()).toBe("50000");
  const customer = await makePartner({ isCustomer: true });
  await createSaleOrderIdempotent(prisma, actor, `reference-order-${++n}`, {
    partnerId: customer.id, date: "2026-09-20", expectedDeliveryDate: "2026-09-20", note: "",
    lines: [{ productId: finished.id, processingTypeId: type.id, issueMode: "BOM", unit: "md", qty: 1, salePrice: 100000, discountNow: 0, discountAccum: 0 }],
  }, at);
  expect([...await usedReferenceCostPlanIds(prisma, [first.id])]).toEqual([first.id]);
  await expect(save({ fixedPricePerM2: 60000 })).rejects.toThrow(/đã được dùng/);
  await expect(prisma.$transaction(tx => deleteReferenceCostPlan(tx, actor, finished.id, first.id))).rejects.toThrow(/không xoá được/);
  const future = await save({ validFrom: "2026-09-25" });
  expect(await usedReferenceCostPlanIds(prisma, [future.id])).toEqual(new Set());
  await prisma.$transaction(tx => deleteReferenceCostPlan(tx, actor, finished.id, future.id));
  expect(await prisma.referenceCostPlan.count()).toBe(1);
  expect(await prisma.auditLog.count({ where: { action: "reference-cost.delete" } })).toBe(1);
  await expect(prisma.$transaction(tx => deleteReferenceCostPlan(tx, { ...actor, perms: new Set(["product.view", "cost.view", "purchase_price.view"]) }, finished.id, first.id))).rejects.toThrow();
});
it("shows a produced accessory's actual unit cost without requiring a purchase of the accessory", async () => {
  const accessory = await makeProduct({ kind: "PHU_KIEN", baseUnit: "md", canProduce: true });
  await buy(w.p.id, 100);
  const p = await createProductionOrderIdempotent(prisma, actor, "produce", { productId: accessory.id, qty: 10, date: "2026-09-16", note: "", materials: [{ productId: w.p.id, qty: 20 }] });
  const reference = await costReference(prisma, actor, accessory.id, null, at);
  expect(reference?.primary).toMatchObject({ kind: "PRODUCTION", perBase: "200", code: p.code });
  await cancelProductionOrderTx(prisma, actor, p.id, "Hủy thử");
  expect((await costReference(prisma, actor, accessory.id, null, at))?.primary).toBeNull();
});
it("keeps purchase and production sources separate and chooses the most recent source for stock", async () => {
  const accessory = await makeProduct({ kind: "PHU_KIEN", baseUnit: "md", canProduce: true });
  await buy(w.p.id, 100); await buy(accessory.id, 300);
  await createProductionOrderIdempotent(prisma, actor, "produce", { productId: accessory.id, qty: 10, date: "2026-09-16", note: "", materials: [{ productId: w.p.id, qty: 20 }] });
  const result = await costReference(prisma, actor, accessory.id, null, at);
  expect(result?.primary?.kind).toBe("PRODUCTION");
  expect(result?.alternatives).toMatchObject([{ kind: "PURCHASE", perBase: "300" }]);
});
it("calculates the effective BOM using each material's last purchase price; stock mode uses the product cost", async () => {
  const type = await makeProcessingType(), material = await makeProduct({ baseUnit: "md", kind: "NVL" });
  const finished = await makeProduct({ baseUnit: "md", kind: "THANH_PHAM", canProduce: true });
  await buy(w.p.id, 100); await buy(material.id, 50);
  await buy(finished.id, 300);
  await makeBomVersion({ productId: finished.id, processingTypeId: type.id, createdBy: w.userId, validFrom: "2026-09-01", lines: [{ materialProductId: w.p.id, qtyPerUnit: 2 }, { materialProductId: material.id, qtyPerUnit: "0.5" }] });
  await makeBomVersion({ productId: finished.id, processingTypeId: type.id, createdBy: w.userId, validFrom: "2026-10-01", lines: [{ materialProductId: w.p.id, qtyPerUnit: 9 }] });
  const count = await prisma.stockLedger.count();
  expect((await costReference(prisma, actor, finished.id, type.id, at))?.primary).toMatchObject({ kind: "BOM", perBase: "225", code: "Định mức v1" });
  expect((await costReference(prisma, actor, finished.id, type.id, at, "STOCK"))?.primary).toMatchObject({ kind: "PURCHASE", perBase: "300" });
  expect(await prisma.stockLedger.count()).toBe(count);
});
it("does not substitute raw product cost when material pricing or effective BOM is missing", async () => {
  const type = await makeProcessingType(), missing = await makeProduct({ baseUnit: "md", kind: "NVL" });
  await buy(w.p.id, 100);
  await makeBomVersion({ productId: w.p.id, processingTypeId: type.id, createdBy: w.userId, validFrom: "2026-09-01", lines: [{ materialProductId: missing.id, qtyPerUnit: 1 }] });
  const result = await costReference(prisma, actor, w.p.id, type.id, at);
  expect(result?.primary?.perBase).toBeNull(); expect(result?.materials?.[0].price).toBeNull();
  expect(result?.message).toContain(missing.name);
  const noType = await makeProcessingType();
  expect((await costReference(prisma, actor, w.p.id, noType.id, at, "BOM"))?.primary).toBeNull();
});
it("respects permissions and excludes cancelled or later purchases", async () => {
  await buy(w.p.id, 100);
  const second = await buy(w.p.id, 120, "2026-09-16");
  await buy(w.p.id, 150, "2026-09-21");
  expect((await costReference(prisma, actor, w.p.id, null, at))?.primary?.perBase).toBe("120");
  await cancelPurchaseTx(prisma, actor, second.id, "Hủy thử");
  expect((await costReference(prisma, actor, w.p.id, null, at))?.primary?.perBase).toBe("100");
  expect(await costReference(prisma, { ...actor, perms: new Set() }, w.p.id, null, at)).toBeUndefined();
  expect(await costReference(prisma, { ...actor, perms: new Set(["cost.view", "purchase_price.view"]) }, w.p.id, null, at)).toBeUndefined();
  const type = await makeProcessingType();
  const material = await makeProduct({ baseUnit: "md", kind: "NVL" });
  await makeBomVersion({ productId: w.p.id, processingTypeId: type.id, createdBy: w.userId, lines: [{ materialProductId: material.id, qtyPerUnit: 2 }] });
  const restricted = await costReference(prisma, { ...actor, perms: new Set(["order.analysis.view", "purchase_price.view"]) }, w.p.id, type.id, at);
  expect(restricted?.primary).toBeNull(); expect(restricted?.materials).toBeUndefined();
});

it("uses a fixed auxiliary-material price instead of BOM purchase prices, even when a BOM price is missing", async () => {
  const { type, finished, save } = await plannedWorld(); await save({ auxFixedPerMeter: 1000 });
  const ref = await costReference(prisma, actor, finished.id, type.id, at);
  expect(ref?.primary?.perBase).toBe("50867.76"); // 44322*1.08 + 1000 + 2000
  expect(ref?.components?.map(c => c.perBase)).toEqual(["47867.76", "1000", "2000"]);
  expect(ref?.materials).toEqual([]);
  expect(referenceCostPlanSchema.safeParse({ processingTypeId: 1, scope: "TYPE", validFrom: "2026-09-20", tonProductId: null, fixedPricePerM2: null, feePerMeter: 1, auxFixedPerMeter: 5 }).success).toBe(false);
});

it("applies one plan to many products of a type in one transaction and skips products not linked or not in meters", async () => {
  const { type, finished, save } = await plannedWorld(); void save;
  const second = await makeProduct({ baseUnit: "md", kind: "THANH_PHAM", canProduce: true });
  await prisma.productProcessingRatio.create({ data: { productId: second.id, processingTypeId: type.id, updatedBy: w.userId } });
  const unlinked = await makeProduct({ baseUnit: "md", kind: "THANH_PHAM" });
  const kg = await makeProduct({ baseUnit: "kg", kind: "THANH_PHAM" });
  await prisma.productProcessingRatio.create({ data: { productId: kg.id, processingTypeId: type.id, updatedBy: w.userId } });
  const input = bulkReferenceCostPlanSchema.parse({ processingTypeId: type.id, validFrom: "2026-09-20", tonProductId: w.p.id, fixedPricePerM2: 44322, feePerMeter: 2000, auxFixedPerMeter: 1000, productIds: [finished.id, second.id, unlinked.id, kg.id] });
  const r = await prisma.$transaction(tx => bulkCreateReferenceCostPlans(tx, actor, input, new Date("2026-09-20T01:00:00Z")));
  expect(r.created).toBe(2); expect(r.skipped).toHaveLength(2);
  const rows = await prisma.referenceCostPlan.findMany({ where: { processingTypeId: type.id, productId: { not: null } } });
  expect(rows.map(x => x.productId).sort()).toEqual([finished.id, second.id].sort());
  expect(rows.every(x => x.auxFixedPerMeter?.toString() === "1000" && x.fixedPricePerM2?.toString() === "44322")).toBe(true);
  expect(bulkReferenceCostPlanSchema.safeParse({ ...input, productIds: [], allLinked: false }).success).toBe(false);
  const all = await prisma.$transaction(tx => bulkCreateReferenceCostPlans(tx, actor, bulkReferenceCostPlanSchema.parse({ ...input, productIds: undefined, allLinked: true, validFrom: "2026-09-21" }), new Date("2026-09-20T01:00:00Z")));
  expect(all.created).toBe(2);
});

it("tôn là chính mã bán + kiểu có tỷ lệ trừ kho ⇒ không cảnh báo thiếu tôn trong BOM, tôn tính theo tỷ lệ trừ kho", async () => {
  const { type, finished, save } = await plannedWorld(false);
  await prisma.processingType.update({ where: { id: type.id }, data: { stockRatio: "1" } });
  await prisma.productProcessingRatio.update({ where: { productId_processingTypeId: { productId: finished.id, processingTypeId: type.id } }, data: { ratio: "1.08" } });
  await prisma.product.update({ where: { id: finished.id }, data: { canUseAsMaterial: true } });
  await buy(finished.id, 100);
  await save({ tonProductId: finished.id, fixedPricePerM2: null, feePerMeter: 2000 });
  const ref = await costReference(prisma, actor, finished.id, type.id, at);
  expect(ref?.stockWarning).toBeUndefined();
  expect(ref?.message).toContain("tỷ lệ trừ kho");
  expect(ref?.primary?.perBase).toBe("2125"); // 100 (giá nhập tôn) × 1 + 0.5 × 50 (phụ) + 2000 (phí)
});
