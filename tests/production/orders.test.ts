import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { getProductionOrder, listProductionOrders } from "@/server/production/queries";
import { parseListParams } from "@/lib/query-params";
import { cancelProductionOrderTx, createProductionOrderIdempotent } from "@/server/production/service";
import { productionOrderSchema } from "@/server/production/schemas";
import { prisma, resetDb } from "../helpers/db";
import { makeProduct } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

let w: World; let actor: Actor; let pk: { id: number }; let tonB: { id: number }; let giay: { id: number };
let n = 0;
const make = (over: Record<string, unknown> = {}) => productionOrderSchema.parse({ date: "2026-09-15", productId: pk.id, qty: 10, note: "", materials: [{ productId: w.p.id, qty: 20 }, { productId: giay.id, qty: 5 }], ...over });
const create = (over: Record<string, unknown> = {}, a = actor) => createProductionOrderIdempotent(prisma, a, `p-${++n}`, make(over));
const layer = (id: number) => prisma.costLayer.findFirstOrThrow({ where: { sourceDocType: "PRODUCTION_OUT", sourceDocId: id } });

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(["production.manage", "cost.view"]) };
  pk = await makeProduct({ kind: "PHU_KIEN", code: "PK1" });
  giay = await makeProduct({ kind: "NVL", code: "GB1" });
  tonB = await makeProduct({ kind: "NVL", code: "TON1" });
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
  await engine(w)([giay.id], (ctx) => buy(ctx, giay.id, 50, 4_000, T(0), 1));
});

describe("lệnh sản xuất phụ kiện", () => {
  it("xuất NVL theo FIFO, nhập thành phẩm với giá = Σ vốn NVL / SL", async () => {
    const o = await create(); // 20×10.000 + 5×4.000 = 220.000 / 10 = 22.000
    expect(o.code).toMatch(/^SX\d{6}$/);
    expect(Number((await layer(o.id)).unitCost)).toBe(22_000);
    const onHand = async (id: number) => (await prisma.costLayer.aggregate({ where: { productId: id }, _sum: { qtyRemaining: true } }))._sum.qtyRemaining!.toString();
    expect(await onHand(w.p.id)).toBe("80"); expect(await onHand(giay.id)).toBe("45"); expect(await onHand(pk.id)).toBe("10");
    expect(await prisma.productionMaterial.count({ where: { orderId: o.id, seq: { not: null } } })).toBe(2);
  });
  it("giá thành phẩm đổi theo FIFO khi lệnh sau dùng lớp NVL mới", async () => {
    await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20_000, T(5), 2));
    const a = await create({ materials: [{ productId: w.p.id, qty: 100 }] }); // toàn bộ lớp 10.000
    const b = await create({ materials: [{ productId: w.p.id, qty: 10 }] }); // lớp 20.000
    expect(Number((await layer(a.id)).unitCost)).toBe(100_000);
    expect(Number((await layer(b.id)).unitCost)).toBe(20_000);
  });
  it("cùng khoá idempotency ⇒ một lệnh, không xuất NVL hai lần", async () => {
    const input = make();
    const [a, b] = [await createProductionOrderIdempotent(prisma, actor, "same", input), await createProductionOrderIdempotent(prisma, actor, "same", input)];
    expect(a.id).toBe(b.id); expect(await prisma.productionOrder.count()).toBe(1);
    expect((await prisma.costLayer.aggregate({ where: { productId: w.p.id }, _sum: { qtyRemaining: true } }))._sum.qtyRemaining!.toString()).toBe("80");
  });
  it("chặn: không đủ tồn NVL, sản phẩm không phải phụ kiện, NVL trùng/lặp, thiếu quyền", async () => {
    await expect(create({ materials: [{ productId: w.p.id, qty: 101 }] })).rejects.toMatchObject({ status: 409 });
    await expect(create({ productId: w.p.id })).rejects.toMatchObject({ status: 400 });
    await expect(create({ materials: [{ productId: pk.id, qty: 1 }] })).rejects.toMatchObject({ status: 400 });
    await expect(create({ materials: [{ productId: w.p.id, qty: 1 }, { productId: w.p.id, qty: 2 }] })).rejects.toMatchObject({ status: 400 });
    await expect(create({}, { userId: w.userId, perms: new Set(["cost.view"]) })).rejects.toMatchObject({ status: 403 });
    expect(() => make({ qty: 0 })).toThrow(); expect(() => make({ materials: [] })).toThrow();
  });
  it("hủy lệnh hoàn NVL và gỡ thành phẩm; lệnh đã hủy không hủy lại", async () => {
    const o = await create();
    await cancelProductionOrderTx(prisma, actor, o.id, "nhập nhầm");
    const sum = async (id: number) => (await prisma.costLayer.aggregate({ where: { productId: id }, _sum: { qtyRemaining: true } }))._sum.qtyRemaining?.toString() ?? "0";
    expect(await sum(w.p.id)).toBe("100"); expect(await sum(giay.id)).toBe("50"); expect(await sum(pk.id)).toBe("0");
    await expect(cancelProductionOrderTx(prisma, actor, o.id, "lại")).rejects.toMatchObject({ status: 409 });
  });
  it("danh sách lọc theo trạng thái/tìm kiếm; chi tiết chỉ lộ giá thành khi có cost.view", async () => {
    const a = await create(), b = await create({ qty: 5 });
    await cancelProductionOrderTx(prisma, actor, b.id, "sai số lượng");
    const list = (sp: Record<string, string>) => listProductionOrders(prisma, actor, parseListParams(sp, ["status"]));
    expect((await list({})).total).toBe(2);
    expect((await list({ status: "active" })).rows.map((r) => r.id)).toEqual([a.id]);
    expect((await list({ q: "PK1" })).total).toBe(2); expect((await list({ q: "khong-co" })).total).toBe(0);
    const full = await getProductionOrder(prisma, actor, a.id);
    expect(full.unitCost).toBe("22000"); expect(full.totalCost).toBe("220000");
    expect(full.materials.map((m) => m.unitCost)).toEqual(["200000", "20000"]);
    const noCost = await getProductionOrder(prisma, { userId: w.userId, perms: new Set(["production.manage"]) }, a.id);
    expect(noCost.unitCost).toBeUndefined(); expect(noCost.materials.every((m) => m.unitCost === undefined)).toBe(true);
    await expect(getProductionOrder(prisma, { userId: 1, perms: new Set() }, a.id)).rejects.toMatchObject({ status: 403 });
    await expect(getProductionOrder(prisma, actor, 99999)).rejects.toMatchObject({ status: 404 });
  });
});
