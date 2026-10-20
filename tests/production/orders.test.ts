import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { getProductionOrder, listProductionOrders } from "@/server/production/queries";
import { parseListParams } from "@/lib/query-params";
import { cancelProductionOrderTx, createProductionOrderIdempotent } from "@/server/production/service";
import { productionOrderSchema } from "@/server/production/schemas";
import { updateLayerCost } from "@/server/inventory/ports";
import { postIssue } from "@/server/inventory";
import { productionReport } from "@/server/reports/consumption";
import { prisma, resetDb } from "../helpers/db";
import { makeProduct } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

let w: World; let actor: Actor; let pk: { id: number }; let giay: { id: number };
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
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
  await engine(w)([giay.id], (ctx) => buy(ctx, giay.id, 50, 4_000, T(0), 1));
});

describe("lệnh sản xuất phụ kiện", () => {
  const slitInput = (secondId: number, width = 300) => productionOrderSchema.parse({ date: "2026-09-15", note: "Xẻ 900 + 300", allocationBasis: "AREA", materials: [{ productId: w.p.id, qty: 10, widthMm: 1200 }], outputs: [{ productId: pk.id, qty: 10, widthMm: 900, stripCount: 1, lengthM: 10 }, { productId: secondId, qty: 10, widthMm: width, stripCount: 1, lengthM: 10 }] });
  async function slit() {
    await prisma.product.update({ where: { id: pk.id }, data: { baseUnit: "md" } });
    const second = await makeProduct({ kind: "PHU_KIEN", code: "TON300", baseUnit: "md" });
    const input = slitInput(second.id);
    const order = await createProductionOrderIdempotent(prisma, actor, `slit-${++n}`, input);
    return { ...order, second, input };
  }
  it("xẻ 10m khổ 1200 thành 10m khổ 900 + 10m khổ 300, giá vốn 75%/25%, báo cáo đủ hai mã", async () => {
    const o = await slit();
    const layers = await prisma.costLayer.findMany({ where: { sourceDocType: "PRODUCTION_OUT", sourceDocId: o.id }, orderBy: { productId: "asc" } });
    expect(layers.map(l => [l.productId, String(l.qtyIn), String(l.unitCost), String(l.costRefShare)])).toEqual([[pk.id, "10", "7500", "0.75"], [o.second.id, "10", "2500", "0.25"]]);
    expect(layers.reduce((sum, l) => sum + Number(l.qtyIn) * Number(l.unitCost), 0)).toBe(100000);
    const detail = await getProductionOrder(prisma, actor, o.id);
    expect(detail.outputs?.map(x => x.productCode)).toEqual(["PK1", "TON300"]);
    expect(detail.totalCost).toBe("100000");
    const list = await listProductionOrders(prisma, actor, parseListParams({ q: "TON300" }, ["status"]));
    expect(list.rows.map(r => r.id)).toEqual([o.id]);
    const report = await productionReport(prisma, { start: new Date("2026-09-01"), end: new Date("2026-10-01") }, true);
    expect(report.rows).toHaveLength(2);
    expect(report.totals?.totalCost).toBe("100000");
    const hidden = await getProductionOrder(prisma, { ...actor, perms: new Set(["production.manage"]) }, o.id);
    expect(hidden.outputs?.every(x => x.unitCost === undefined && x.totalCost === undefined)).toBe(true);
  });
  it("đổi giá nguyên liệu lan truyền lại cả hai đầu ra, giữ tổng vốn và tỷ lệ", async () => {
    const o = await slit();
    const source = await prisma.costLayer.findFirstOrThrow({ where: { productId: w.p.id, sourceDocType: "PURCHASE" } });
    await engine(w)([w.p.id, giay.id], ctx => updateLayerCost(ctx, { docType: "PURCHASE", docId: source.sourceDocId, unitCost: 20000 }));
    const layers = await prisma.costLayer.findMany({ where: { sourceDocType: "PRODUCTION_OUT", sourceDocId: o.id }, orderBy: { productId: "asc" } });
    expect(layers.map(l => String(l.unitCost))).toEqual(["15000", "5000"]);
  });
  it("xẻ khổ 300: bốn dải 10m nhập 40m, không so tổng mét với nguyên liệu", async () => {
    await prisma.product.update({ where: { id: pk.id }, data: { baseUnit: "md" } });
    const input = productionOrderSchema.parse({ date: "2026-09-15", note: "", allocationBasis: "AREA", materials: [{ productId: w.p.id, qty: 10, widthMm: 1200 }], outputs: [{ productId: pk.id, qty: 40, stripCount: 4, lengthM: 10, widthMm: 300 }] });
    const o = await createProductionOrderIdempotent(prisma, actor, "four-strips", input);
    expect(String((await layer(o.id)).unitCost)).toBe("2500");
    expect(String((await layer(o.id)).qtyIn)).toBe("40");
  });
  it("chặn vượt khổ, chiều dài sai, mã đầu ra lặp, số lượng sai và đơn vị không phải mét dài", async () => {
    expect(() => slitInput(999, 400)).toThrow("Tổng khổ đầu ra vượt");
    expect(() => slitInput(pk.id)).toThrow("bị lặp");
    const good = slitInput(999);
    expect(productionOrderSchema.safeParse({ ...good, outputs: [{ ...good.outputs![0], qty: 11 }] }).success).toBe(false);
    expect(productionOrderSchema.safeParse({ ...good, outputs: [{ ...good.outputs![0], lengthM: 9, qty: 9 }] }).success).toBe(false);
    const second = await makeProduct({ kind: "PHU_KIEN", code: "TON300", baseUnit: "md" });
    await prisma.product.update({ where: { id: pk.id }, data: { baseUnit: "cái" } });
    await expect(createProductionOrderIdempotent(prisma, actor, "wrong-unit", slitInput(second.id))).rejects.toMatchObject({ status: 400 });
    expect(await prisma.productionOrder.count()).toBe(0);
  });
  it("nhiều đầu ra cần trọng số rõ ràng; giữ idempotency, hủy hoàn NVL và gỡ mọi đầu ra", async () => {
    const o = await slit();
    const again = await createProductionOrderIdempotent(prisma, actor, `slit-${n}`, o.input);
    expect(again.id).toBe(o.id);
    expect(await prisma.productionOutput.count()).toBe(2);
    expect(productionOrderSchema.safeParse({ ...o.input, allocationBasis: "WEIGHT" }).success).toBe(false);
    await cancelProductionOrderTx(prisma, actor, o.id, "nhập nhầm");
    expect(await prisma.costLayer.count({ where: { sourceDocType: "PRODUCTION_OUT", sourceDocId: o.id } })).toBe(0);
    expect(String((await prisma.costLayer.findFirstOrThrow({ where: { productId: w.p.id } })).qtyRemaining)).toBe("100");
  });
  it("đầu ra phụ đã dùng cũng chặn hủy toàn bộ lệnh", async () => {
    const o = await slit();
    await engine(w)([o.second.id], ctx => postIssue(ctx, { productId: o.second.id, qty: 1, docType: "ADJ_LOSS", docId: 999, docLineId: 999, at: new Date("2026-09-16T03:00:00Z") }));
    await expect(cancelProductionOrderTx(prisma, actor, o.id, "nhập nhầm")).rejects.toMatchObject({ code: "PRODUCTION_OUTPUT_CONSUMED" });
    expect(await prisma.costLayer.count({ where: { sourceDocType: "PRODUCTION_OUT", sourceDocId: o.id } })).toBe(2);
  });
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
