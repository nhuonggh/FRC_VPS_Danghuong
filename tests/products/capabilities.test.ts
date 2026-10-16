import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { makeBomVersion, makePartner, makeProcessingType, makeProduct } from "../helpers/factories";
import { assertLedgerBalanced, buy, engine, newWorld, T, type World } from "../inventory/helpers";
import { createProductionOrderIdempotent, cancelProductionOrderTx } from "@/server/production/service";
import { createSaleOrderIdempotent, planLines } from "@/server/sales/service";
import { saleOrderSchema } from "@/server/sales/schemas";
import { getOnHand } from "@/server/inventory";
import { exportProductsXlsx, PRODUCT_FILTER_KEYS, searchProducts } from "@/server/products/queries";
import { updateProductBasic } from "@/server/products/service";
import { parseListParams } from "@/lib/query-params";
import { productImportSpec } from "@/server/products/import-spec";
import { commitImport } from "@/server/import/framework";
import { toXlsx } from "../../scripts/lib/customer-data";
import type { Actor } from "@/lib/permissions/scope";

let w: World;
let actor: Actor;
const now = new Date("2026-09-15T03:00:00Z");
beforeEach(async () => {
  await resetDb();
  w = await newWorld();
  actor = { userId: w.userId, perms: new Set(["production.manage", "order.create", "order.edit_price", "sale_price.view", "partner.view_all", "product.manage", "data.import"]) };
});

describe("independent product capabilities", () => {
  it("shares one FIFO stock between selling a finished product and consuming it to produce an accessory", async () => {
    const a = await makeProduct({ kind: "THANH_PHAM", canUseAsMaterial: true });
    const b = await makeProduct({ kind: "PHU_KIEN" });
    const customer = await makePartner({ isCustomer: true });
    await engine(w)([a.id], (ctx) => buy(ctx, a.id, 100, 10000, T(0), 1));
    const input = saleOrderSchema.parse({ partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: [{ productId: a.id, unit: "md", qty: 30, salePrice: 15000, discountNow: 0, discountAccum: 0, processingTypeId: null, issueMode: "STOCK" }] });
    await createSaleOrderIdempotent(prisma, actor, "sell-a", input, now);
    const order = await createProductionOrderIdempotent(prisma, actor, "produce-b", { productId: b.id, qty: 10, date: "2026-09-15", note: "", materials: [{ productId: a.id, qty: 20 }] });
    expect((await getOnHand(prisma, w.periodId, a.id)).toString()).toBe("50");
    const layer = await prisma.costLayer.findFirstOrThrow({ where: { sourceDocType: "PRODUCTION_OUT", sourceDocId: order.id } });
    expect(layer.unitCost.toString()).toBe("20000");
    await assertLedgerBalanced(a.id, w.periodId);
    await assertLedgerBalanced(b.id, w.periodId);
    await cancelProductionOrderTx(prisma, actor, order.id, "Test reversal");
    expect((await getOnHand(prisma, w.periodId, a.id)).toString()).toBe("70");
  });

  it("rejects disabled material use and rejects a finished product without actual stock", async () => {
    const a = await makeProduct({ kind: "THANH_PHAM" });
    const b = await makeProduct({ kind: "PHU_KIEN" });
    const input = { productId: b.id, qty: 1, date: "2026-09-15", note: "", materials: [{ productId: a.id, qty: 1 }] };
    await expect(createProductionOrderIdempotent(prisma, actor, "disabled", input)).rejects.toMatchObject({ status: 400 });
    await prisma.product.update({ where: { id: a.id }, data: { canUseAsMaterial: true } });
    await expect(createProductionOrderIdempotent(prisma, actor, "no-stock", input)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.productionOrder.count()).toBe(0);
  });

  it("carries derived FIFO cost through two production stages and blocks reversing a consumed output", async () => {
    const a = await makeProduct({ kind: "THANH_PHAM", canUseAsMaterial: true });
    const b = await makeProduct({ kind: "PHU_KIEN" });
    await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10000, T(0), 1));
    const first = await createProductionOrderIdempotent(prisma, actor, "stage-a", { productId: a.id, qty: 10, date: "2026-09-15", note: "", materials: [{ productId: w.p.id, qty: 20 }] });
    const second = await createProductionOrderIdempotent(prisma, actor, "stage-b", { productId: b.id, qty: 2, date: "2026-09-15", note: "", materials: [{ productId: a.id, qty: 3 }] });
    const layer = await prisma.costLayer.findFirstOrThrow({ where: { sourceDocType: "PRODUCTION_OUT", sourceDocId: second.id } });
    expect(layer.unitCost.toString()).toBe("30000");
    await expect(cancelProductionOrderTx(prisma, actor, first.id, "Already consumed")).rejects.toMatchObject({ status: 409 });
    expect((await getOnHand(prisma, w.periodId, a.id)).toString()).toBe("7");
    await assertLedgerBalanced(a.id, w.periodId);
  });

  it("filters by capabilities and keeps them when classification changes", async () => {
    const a = await makeProduct({ kind: "THANH_PHAM", canUseAsMaterial: true, canSell: false });
    expect((await searchProducts(prisma, { capability: "canUseAsMaterial" })).some((p) => p.value === a.id)).toBe(true);
    expect((await searchProducts(prisma, { capability: "canSell" })).some((p) => p.value === a.id)).toBe(false);
    await prisma.$transaction((tx) => updateProductBasic(tx, actor, a.id, { name: a.name, kind: "NVL", baseUnit: "md", isCoil: false, note: "" }));
    expect(await prisma.product.findUnique({ where: { id: a.id } })).toMatchObject({ canSell: false, canUseAsMaterial: true, canProduce: true });
  });

  it("old Excel templates preserve flags and exported capability columns round-trip", async () => {
    const a = await makeProduct({ kind: "THANH_PHAM", canSell: false, canPurchase: false, canUseAsMaterial: true });
    const old = await toXlsx(["Mã", "Tên", "Loại", "Đơn vị gốc"], [[a.code, a.name, "Thành phẩm", "md"]]);
    await commitImport(prisma, actor, productImportSpec(), old, { overwrite: true, idempotencyKey: "old-template" });
    expect(await prisma.product.findUnique({ where: { id: a.id } })).toMatchObject({ canSell: false, canPurchase: false, canUseAsMaterial: true, canProduce: true });
    const exported = await exportProductsXlsx(prisma, parseListParams({}, PRODUCT_FILTER_KEYS));
    await prisma.product.update({ where: { id: a.id }, data: { canUseAsMaterial: false } });
    const result = await commitImport(prisma, actor, productImportSpec(), exported, { overwrite: true, idempotencyKey: "round-trip" });
    expect(result.failed).toBe(0);
    expect(await prisma.product.findUnique({ where: { id: a.id } })).toMatchObject({ canSell: false, canPurchase: false, canUseAsMaterial: true, canProduce: true });
  });

  it("stock mode ignores BOM even with processing metadata; BOM mode issues only components", async () => {
    const a = await makeProduct({ kind: "THANH_PHAM" });
    const pt = await makeProcessingType();
    await makeBomVersion({ productId: a.id, processingTypeId: pt.id, createdBy: w.userId, lines: [{ materialProductId: w.p.id, qtyPerUnit: 2 }] });
    const customer = await makePartner({ isCustomer: true });
    const input = saleOrderSchema.parse({ partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "", lines: [{ productId: a.id, unit: "md", qty: 3, salePrice: 15000, discountNow: 0, discountAccum: 0, processingTypeId: pt.id, issueMode: "STOCK" }] });
    const stock = await planLines(prisma, input, now);
    expect(stock[0]!.issues.map((i) => [i.productId, i.qtyBase.toString()])).toEqual([[a.id, "3"]]);
    expect(stock[0]!.bomVersionId).toBeNull();
    input.lines[0]!.issueMode = "BOM";
    const bom = await planLines(prisma, input, now);
    expect(bom[0]!.issues.map((i) => [i.productId, i.qtyBase.toString()])).toEqual([[w.p.id, "6"]]);
    expect(bom[0]!.bomVersionId).not.toBeNull();
    await prisma.product.update({ where: { id: a.id }, data: { canSell: false } });
    await expect(planLines(prisma, input, now)).rejects.toMatchObject({ status: 400 });
  });
});
