import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { toIct } from "@/lib/time";
import { cancelPurchaseTx, createPurchaseIdempotent, updatePurchaseFreightTx, updatePurchaseTx } from "@/server/purchase/service";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makePeriod, makeProduct, makeUser } from "../helpers/factories";
import { assertLedgerBalanced } from "../inventory/helpers";

const todayIct = () => {
  const now = toIct(new Date());
  return `${now.y}-${String(now.m + 1).padStart(2, "0")}-${String(now.d).padStart(2, "0")}`;
};

let actor: Actor;
let periodId: number;
let supplierId: number;
let productId: number;

const document = (over: Record<string, unknown> = {}) => ({
  partnerId: supplierId, date: todayIct(), freightCost: 0, note: "",
  lines: [{ productId, qty: 100, unit: "kg", factor: 2, purchasePrice: 20_000, rollInfo: "Cuộn A" }],
  ...over,
});

beforeEach(async () => {
  await resetDb();
  const user = await makeUser();
  const period = await makePeriod({ openedAt: new Date(Date.now() - 86_400_000) });
  const supplier = await makePartner({ isCustomer: false, isSupplier: true, isActive: true });
  const product = await makeProduct({ baseUnit: "md", isActive: true });
  await prisma.productUnit.create({ data: { productId: product.id, unit: "kg", factor: 2 } });
  actor = { userId: user.id, perms: new Set(["purchase.create", "purchase.edit", "purchase.cancel", "purchase_price.view"]) };
  periodId = period.id;
  supplierId = supplier.id;
  productId = product.id;
});

describe("purchase service", () => {
  it("creates one idempotent receipt, inventory lot and supplier liability excluding freight", async () => {
    const [first, replay] = await Promise.all([
      createPurchaseIdempotent(prisma, actor, "receipt-1", document({ freightCost: 1_000 })),
      createPurchaseIdempotent(prisma, actor, "receipt-1", document({ freightCost: 1_000 })),
    ]);
    expect(first).toEqual(replay);
    expect(first.code).toBe("PN000001");
    const line = await prisma.purchaseLine.findFirstOrThrow({ where: { purchaseId: first.id } });
    const layer = await prisma.costLayer.findFirstOrThrow({ where: { sourceDocId: first.id } });
    const debt = await prisma.partnerLedger.findFirstOrThrow({ where: { docType: "PURCHASE", docId: first.id } });
    expect([line.qtyBase.toString(), line.allocatedFreight.toString(), layer.unitCost.toString(), debt.credit.toString()])
      .toEqual(["50", "1000", "40020", "2000000"]);
    expect(await prisma.purchase.count()).toBe(1);
    await assertLedgerBalanced(productId, periodId);
  });

  it("edits, updates freight and cancels the receipt through the FIFO transaction", async () => {
    const created = await createPurchaseIdempotent(prisma, actor, "receipt-edit", document());
    const original = await prisma.purchaseLine.findFirstOrThrow({ where: { purchaseId: created.id } });
    await updatePurchaseTx(prisma, actor, created.id, document({
      lines: [{ id: original.id, productId, qty: 120, unit: "kg", factor: 2, purchasePrice: 21_000, rollInfo: "Cuộn B" }],
    }));
    await updatePurchaseFreightTx(prisma, actor, created.id, 600);
    expect((await prisma.purchaseLine.findUniqueOrThrow({ where: { id: original.id } })).allocatedFreight.toString()).toBe("600");
    await cancelPurchaseTx(prisma, actor, created.id, "Nhập nhầm");
    expect((await prisma.purchase.findUniqueOrThrow({ where: { id: created.id } })).isCancelled).toBe(true);
    expect(await prisma.stockLedger.count({ where: { docType: "PURCHASE", docId: created.id } })).toBe(0);
    expect(await prisma.partnerLedger.count({ where: { docType: "PURCHASE", docId: created.id } })).toBe(0);
    await assertLedgerBalanced(productId, periodId);
  });
});
