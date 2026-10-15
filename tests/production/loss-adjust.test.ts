import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { getOnHand } from "@/server/inventory";
import { lossAdjustSchema } from "@/server/stock-adjust/schemas";
import { cancelLossAdjust, createLossAdjustIdempotent, getLossAdjust, listLossAdjusts } from "@/server/stock-adjust/service";
import { prisma, resetDb } from "../helpers/db";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

let w: World; let actor: Actor; let n = 0;
const input = (over: Record<string, unknown> = {}) => lossAdjustSchema.parse({ type: "LOSS", date: "2026-09-15", note: "cắt lỗi tháng 9", lines: [{ productId: w.p.id, qty: 4 }], ...over });
const create = (over: Record<string, unknown> = {}, a = actor) => createLossAdjustIdempotent(prisma, a, `l-${++n}`, input(over));
const onHand = async () => (await getOnHand(prisma, w.periodId, w.p.id)).toString();

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(["stock_adjust.manage", "cost.view"]) };
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 10, 10_000, T(0), 1));
});

describe("điều chỉnh hao hụt / xuất hủy", () => {
  it("xuất kho FIFO theo giá vốn, sinh mã HH/XH, chi tiết có giá vốn khi cost.view", async () => {
    const a = await create(), b = await create({ type: "WRITE_OFF", lines: [{ productId: w.p.id, qty: 1 }] });
    expect(a.code).toMatch(/^HH\d{6}$/); expect(b.code).toMatch(/^XH\d{6}$/);
    expect(await onHand()).toBe("5");
    const d = await getLossAdjust(prisma, actor, a.id);
    expect(d.lines[0]).toMatchObject({ qty: "4", cost: "40000" });
    expect((await getLossAdjust(prisma, { userId: w.userId, perms: new Set(["stock_adjust.manage"]) }, a.id)).lines[0]).not.toHaveProperty("cost");
  });
  it("chặn xuất quá tồn, thiếu lý do, dòng lặp, thiếu quyền; cùng khoá idempotency ⇒ một phiếu", async () => {
    await expect(create({ lines: [{ productId: w.p.id, qty: 11 }] })).rejects.toMatchObject({ status: 409 });
    expect(() => input({ note: " " })).toThrow(); expect(() => input({ type: "IN" })).toThrow();
    await expect(create({ lines: [{ productId: w.p.id, qty: 1 }, { productId: w.p.id, qty: 1 }] })).rejects.toMatchObject({ status: 400 });
    await expect(create({}, { userId: 1, perms: new Set() })).rejects.toMatchObject({ status: 403 });
    await createLossAdjustIdempotent(prisma, actor, "same", input()); await createLossAdjustIdempotent(prisma, actor, "same", input());
    expect(await onHand()).toBe("6");
  });
  it("hủy phiếu hoàn tồn; không hủy hai lần; danh sách lọc theo loại/trạng thái", async () => {
    const a = await create(), b = await create({ type: "WRITE_OFF", lines: [{ productId: w.p.id, qty: 1 }] });
    await cancelLossAdjust(prisma, actor, a.id, "nhập nhầm");
    expect(await onHand()).toBe("9");
    await expect(cancelLossAdjust(prisma, actor, a.id, "lại")).rejects.toMatchObject({ status: 409 });
    const l = (sp: Record<string, string>) => listLossAdjusts(prisma, actor, parseListParams(sp, ["status", "type"]));
    expect((await l({})).total).toBe(2); expect((await l({ status: "active" })).rows.map((r) => r.id)).toEqual([b.id]);
    expect((await l({ type: "LOSS" })).rows.map((r) => r.id)).toEqual([a.id]);
    await expect(getLossAdjust(prisma, actor, 99999)).rejects.toMatchObject({ status: 404 });
  });
});
