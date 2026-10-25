import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { editSaleOrderTx } from "@/server/sales/lifecycle";
import { getOrder, getOrderForEdit } from "@/server/sales/queries";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makeProduct } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

const PERMS = ["order.create", "order.edit", "sale_price.view", "order.edit_price", "partner.view_all", "order.view"];
let w: World; let actor: Actor; let customer: { id: number }; let fg: { id: number; baseUnit: string };
let n = 0;
const NOW = new Date("2026-09-15T03:00:00Z");

// 1,5 × 237.600 = 356.400 → làm tròn lên nghìn = 357.000
const order = (over: Record<string, unknown> = {}) => saleOrderSchema.parse({
  partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "",
  lines: [{ productId: fg.id, unit: fg.baseUnit, qty: 1.5, salePrice: 237_600, discountNow: 0, discountAccum: 0, processingTypeId: null }], ...over,
});
const total = async (id: number) => (await getOrder(prisma, actor, id)).orderTotal;

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(PERMS) };
  customer = await makePartner({ isCustomer: true });
  fg = await makeProduct({ kind: "THANH_PHAM" });
  await engine(w)([fg.id], (ctx) => buy(ctx, fg.id, 100, 10_000, T(0), 1));
});

describe("tùy chọn làm tròn thành tiền theo đơn", () => {
  it("mặc định làm tròn lên nghìn đồng (đơn cũ/không chọn gì không đổi)", async () => {
    const o = await createSaleOrderIdempotent(prisma, actor, `r-${++n}`, order(), NOW);
    expect((await prisma.saleOrder.findUniqueOrThrow({ where: { id: o.id } })).roundAmounts).toBe(true);
    expect(await total(o.id)).toBe("357000");
  });

  it("tắt làm tròn: thành tiền = SL × đơn giá", async () => {
    const o = await createSaleOrderIdempotent(prisma, actor, `r-${++n}`, order({ roundAmounts: false }), NOW);
    expect((await prisma.saleOrder.findUniqueOrThrow({ where: { id: o.id } })).roundAmounts).toBe(false);
    expect(await total(o.id)).toBe("356400");
  });

  it("sửa đơn đổi được tùy chọn; không gửi cờ khi sửa thì giữ nguyên", async () => {
    const o = await createSaleOrderIdempotent(prisma, actor, `r-${++n}`, order({ roundAmounts: false }), NOW);
    const d = (await getOrderForEdit(prisma, actor, o.id)).defaults;
    expect(d.roundAmounts).toBe(false);
    const { roundAmounts: _drop, ...noFlag } = d;
    await editSaleOrderTx(prisma, actor, o.id, saleOrderSchema.parse(noFlag), NOW);
    expect(await total(o.id)).toBe("356400");
    await editSaleOrderTx(prisma, actor, o.id, saleOrderSchema.parse({ ...d, roundAmounts: true }), NOW);
    expect(await total(o.id)).toBe("357000");
  });

  it("chiết khấu tối đa theo giá trị dòng của đúng chế độ", () => {
    const line = (discountNow: number) => ({ productId: 1, unit: "m", qty: 1.5, salePrice: 237_600, discountNow, discountAccum: 0, processingTypeId: null });
    const base = { partnerId: 1, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "" };
    expect(saleOrderSchema.safeParse({ ...base, lines: [line(356_800)] }).success).toBe(true); // ≤ 357.000
    expect(saleOrderSchema.safeParse({ ...base, roundAmounts: false, lines: [line(356_800)] }).success).toBe(false); // > 356.400
    expect(saleOrderSchema.safeParse({ ...base, roundAmounts: false, lines: [line(356_400)] }).success).toBe(true);
  });
});
