import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { getOnHand } from "@/server/inventory";
import { cancelSaleOrderTx } from "@/server/sales/lifecycle";
import { getOrder } from "@/server/sales/queries";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { prisma, resetDb } from "../helpers/db";
import { makeBomVersion, makePartner, makeProcessingType, makeProduct } from "../helpers/factories";
import { assertLedgerBalanced, buy, engine, newWorld, T, type World } from "../inventory/helpers";

// Bán tôn xốp: xuất NVL theo định mức hiệu lực tại NGÀY ĐƠN (mã 15). Không phải gia công thuê (plan 06-E3).
const PERMS = ["order.analysis.view", "order.create", "order.cancel", "sale_price.view", "cost.view", "order.edit_price", "partner.view_all", "order.view"];
let w: World; let actor: Actor; let customer: { id: number };
let fg: { id: number; code: string; baseUnit: string }; let m1: { id: number }; let m2: { id: number }; let pt: { id: number };
let n = 0;

const bomOrder = (date: string, qty: number, now: Date) =>
  createSaleOrderIdempotent(prisma, actor, `b-${++n}`, saleOrderSchema.parse({
    partnerId: customer.id, date, expectedDeliveryDate: date, note: "",
    lines: [{ productId: fg.id, unit: fg.baseUnit, qty, salePrice: 50_000, discountNow: 0, discountAccum: 0, processingTypeId: pt.id }],
  }), now);
const onHand = async (id: number) => (await getOnHand(prisma, w.periodId, id)).toString();

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(PERMS) };
  customer = await makePartner({ isCustomer: true });
  fg = await makeProduct({ kind: "THANH_PHAM" }); m1 = await makeProduct({ kind: "NVL" }); m2 = await makeProduct({ kind: "NVL" });
  pt = await makeProcessingType();
  await makeBomVersion({ productId: fg.id, processingTypeId: pt.id, createdBy: w.userId, validFrom: "2026-09-01", lines: [{ materialProductId: m1.id, qtyPerUnit: "1.2" }, { materialProductId: m2.id, qtyPerUnit: "0.5" }] });
  await makeBomVersion({ productId: fg.id, processingTypeId: pt.id, createdBy: w.userId, validFrom: "2026-10-01", lines: [{ materialProductId: m1.id, qtyPerUnit: "2" }, { materialProductId: m2.id, qtyPerUnit: "1" }] });
  const run = engine(w);
  await run([m1.id], (ctx) => buy(ctx, m1.id, 100, 10_000, T(0), 1));
  await run([m2.id], (ctx) => buy(ctx, m2.id, 100, 2_000, T(1), 2));
});

describe("issueByBom — định mức theo ngày đơn", () => {
  it("đơn 30/09 dùng định mức cũ, đơn 01/10 dùng định mức mới; đơn cũ KHÔNG đổi khi định mức mới có hiệu lực", async () => {
    const a = await bomOrder("2026-09-30", 10, new Date("2026-09-30T03:00:00Z"));
    const b = await bomOrder("2026-10-01", 10, new Date("2026-10-01T03:00:00Z"));
    const da = await getOrder(prisma, actor, a.id); const db = await getOrder(prisma, actor, b.id);
    expect(da.lines[0]!.issues!.map((i) => i.qtyBase)).toEqual(["12", "5"]);
    expect(da.lines[0]!.bomVersionLabel).toBe("Định mức v1 · từ 01/09/2026");
    expect(db.lines[0]!.issues!.map((i) => i.qtyBase)).toEqual(["20", "10"]);
    expect(db.lines[0]!.bomVersionLabel).toBe("Định mức v2 · từ 01/10/2026");
    // đọc lại đơn cũ SAU khi đơn mới đã dùng v2: vẫn v1
    expect((await getOrder(prisma, actor, a.id)).lines[0]!.issues!.map((i) => i.qtyBase)).toEqual(["12", "5"]);
    expect(await onHand(m1.id)).toBe("68"); // 100 − 12 − 20
    await assertLedgerBalanced(m1.id, w.periodId);
  });

  it("chi tiết từng NVL: SL, vốn FIFO (chỉ cost.view thấy), không có dòng xuất của thành phẩm", async () => {
    const o = await bomOrder("2026-09-15", 10, new Date("2026-09-15T03:00:00Z"));
    const d = await getOrder(prisma, actor, o.id);
    expect(d.lines[0]!.issues!.map((i) => [i.qtyBase, i.materialCost])).toEqual([["12", "120000"], ["5", "10000"]]);
    expect(d.lines[0]!.unitCostFifo).toBe("13000");
    const blind = await getOrder(prisma, { userId: w.userId, perms: new Set(["order.view", "sale_price.view", "partner.view_all"]) }, o.id);
    expect(blind.lines[0]!.issues).toBeUndefined();
    expect(JSON.stringify(blind.lines[0]!)).not.toMatch(/unitCostFifo/);
    expect(await prisma.stockLedger.count({ where: { docType: "SALE", productId: fg.id } })).toBe(0);
  });

  it("thiếu một NVL → đơn treo, chi tiết chỉ rõ NVL nào thiếu bao nhiêu; nhập bù thì hết treo", async () => {
    await resetDb(); // dựng lại với m2 chỉ có 3
    w = await newWorld(1); actor = { userId: w.userId, perms: new Set(PERMS) }; customer = await makePartner({ isCustomer: true });
    fg = await makeProduct({ kind: "THANH_PHAM" }); m1 = await makeProduct({ kind: "NVL" }); m2 = await makeProduct({ kind: "NVL" }); pt = await makeProcessingType();
    await makeBomVersion({ productId: fg.id, processingTypeId: pt.id, createdBy: w.userId, validFrom: "2026-09-01", lines: [{ materialProductId: m1.id, qtyPerUnit: "1.2" }, { materialProductId: m2.id, qtyPerUnit: "0.5" }] });
    const run = engine(w);
    await run([m1.id], (ctx) => buy(ctx, m1.id, 100, 10_000, T(0), 1));
    await run([m2.id], (ctx) => buy(ctx, m2.id, 3, 2_000, T(1), 2));
    const o = await bomOrder("2026-09-15", 10, new Date("2026-09-15T03:00:00Z"));
    const d = await getOrder(prisma, actor, o.id);
    expect(d.lines[0]!.isProvisional).toBe(true);
    expect(d.lines[0]!.issues!.map((i) => i.qtyProvisional)).toEqual(["0", "2"]);
    await run([m2.id], (ctx) => buy(ctx, m2.id, 50, 2_200, new Date("2026-09-16T03:00:00Z"), 3));
    const after = await getOrder(prisma, actor, o.id);
    expect(after.lines[0]!.isProvisional).toBe(false);
    expect(after.lines[0]!.issues!.map((i) => i.qtyProvisional)).toEqual(["0", "0"]);
  });

  it("hủy đơn hoàn đủ mọi NVL", async () => {
    const o = await bomOrder("2026-09-15", 10, new Date("2026-09-15T03:00:00Z"));
    expect([await onHand(m1.id), await onHand(m2.id)]).toEqual(["88", "95"]);
    await cancelSaleOrderTx(prisma, actor, o.id, "Khách đổi ý");
    expect([await onHand(m1.id), await onHand(m2.id)]).toEqual(["100", "100"]);
    await assertLedgerBalanced(m1.id, w.periodId);
    await assertLedgerBalanced(m2.id, w.periodId);
  });
});
