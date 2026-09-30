import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { getOnHand } from "@/server/inventory";
import { getStocktake, listStocktakes } from "@/server/stocktake/queries";
import { stocktakeSchema } from "@/server/stocktake/schemas";
import { cancelStocktake, confirmStocktakeIdempotent, createStocktake, updateStocktake } from "@/server/stocktake/service";
import { prisma, resetDb } from "../helpers/db";
import { makeProduct } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

let w: World; let actor: Actor; let other: { id: number };
let n = 0;
const input = (lines: { productId: number; actualQty: number }[], over: Record<string, unknown> = {}) => stocktakeSchema.parse({ date: "2026-09-15", note: "", lines, ...over });
const onHand = async (id: number) => (await getOnHand(prisma, w.periodId, id)).toString();

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  actor = { userId: w.userId, perms: new Set(["stocktake.manage", "cost.view"]) };
  other = await makeProduct({ kind: "HANG", code: "SP-B" });
  await engine(w)([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 10_000, T(0), 1));
  await engine(w)([other.id], (ctx) => buy(ctx, other.id, 10, 5_000, T(0), 1));
});

describe("kiểm kho", () => {
  it("nháp không đụng kho; chốt: thiếu ⇒ xuất STOCKTAKE_OUT, thừa ⇒ nhập STOCKTAKE_IN theo giá nhập gần nhất, bằng ⇒ không sinh sổ", async () => {
    const st = await createStocktake(prisma, actor, input([{ productId: w.p.id, actualQty: 97 }, { productId: other.id, actualQty: 12 }]), new Date("2026-09-15T03:00:00Z"));
    expect(st.code).toMatch(/^KK\d{6}$/);
    expect(await onHand(w.p.id)).toBe("100");
    const draft = await getStocktake(prisma, actor, st.id);
    expect(draft.status).toBe("DRAFT"); expect(draft.lines.map((l) => [l.systemQty, l.diff])).toEqual([["100", "-3"], ["10", "2"]]);
    const r = await confirmStocktakeIdempotent(prisma, actor, "k1", st.id);
    expect(r).toMatchObject({ over: 1, short: 1 });
    expect(await onHand(w.p.id)).toBe("97"); expect(await onHand(other.id)).toBe("12");
    const done = await getStocktake(prisma, actor, st.id);
    expect(done.status).toBe("DONE"); expect(done.lines.map((l) => [l.systemQty, l.diff, l.unitCost])).toEqual([["100", "-3", null], ["10", "2", "5000"]]);
    const eq = await createStocktake(prisma, actor, input([{ productId: w.p.id, actualQty: 97 }]), new Date("2026-09-15T04:00:00Z"));
    expect(await confirmStocktakeIdempotent(prisma, actor, "k2", eq.id)).toMatchObject({ over: 0, short: 0 });
  });
  it("chốt hai lần cùng khoá ⇒ một lần; khác khoá ⇒ 409; phiếu đã chốt không sửa", async () => {
    const st = await createStocktake(prisma, actor, input([{ productId: w.p.id, actualQty: 90 }]), new Date("2026-09-15T03:00:00Z"));
    await confirmStocktakeIdempotent(prisma, actor, "same", st.id); await confirmStocktakeIdempotent(prisma, actor, "same", st.id);
    expect(await onHand(w.p.id)).toBe("90");
    await expect(confirmStocktakeIdempotent(prisma, actor, "other", st.id)).rejects.toMatchObject({ status: 409 });
    await expect(updateStocktake(prisma, actor, st.id, input([{ productId: w.p.id, actualQty: 1 }]))).rejects.toMatchObject({ status: 409 });
  });
  it("thừa hàng mà chưa từng nhập mua ⇒ chặn, phiếu vẫn là nháp", async () => {
    const fresh = await makeProduct({ kind: "HANG", code: "SP-C" });
    const st = await createStocktake(prisma, actor, input([{ productId: fresh.id, actualQty: 5 }]), new Date("2026-09-15T03:00:00Z"));
    await expect(confirmStocktakeIdempotent(prisma, actor, "k", st.id)).rejects.toMatchObject({ status: 400 });
    expect((await getStocktake(prisma, actor, st.id)).status).toBe("DRAFT");
  });
  it("sửa nháp thay toàn bộ dòng; hủy nháp; hủy phiếu đã chốt hoàn lại tồn", async () => {
    const st = await createStocktake(prisma, actor, input([{ productId: w.p.id, actualQty: 50 }]), new Date("2026-09-15T03:00:00Z"));
    await updateStocktake(prisma, actor, st.id, input([{ productId: other.id, actualQty: 8 }]), new Date("2026-09-15T03:00:00Z"));
    expect((await getStocktake(prisma, actor, st.id)).lines.map((l) => l.productCode)).toEqual(["SP-B"]);
    await confirmStocktakeIdempotent(prisma, actor, "k", st.id); expect(await onHand(other.id)).toBe("8");
    await cancelStocktake(prisma, actor, st.id, "đếm sai");
    expect(await onHand(other.id)).toBe("10"); expect((await getStocktake(prisma, actor, st.id)).status).toBe("CANCELLED");
    await expect(cancelStocktake(prisma, actor, st.id, "lại")).rejects.toMatchObject({ status: 409 });
    const d = await createStocktake(prisma, actor, input([{ productId: w.p.id, actualQty: 1 }]), new Date("2026-09-15T03:00:00Z"));
    await cancelStocktake(prisma, actor, d.id, "không kiểm nữa"); expect(await onHand(w.p.id)).toBe("100");
  });
  it("kiểm tra đầu vào, quyền, danh sách và ẩn giá vốn khi thiếu cost.view", async () => {
    await expect(createStocktake(prisma, actor, input([{ productId: w.p.id, actualQty: 1 }, { productId: w.p.id, actualQty: 2 }]))).rejects.toMatchObject({ status: 400 });
    expect(() => input([{ productId: w.p.id, actualQty: -1 }])).toThrow(); expect(() => input([])).toThrow();
    await expect(createStocktake(prisma, { userId: 1, perms: new Set() }, input([{ productId: w.p.id, actualQty: 1 }]))).rejects.toMatchObject({ status: 403 });
    const a = await createStocktake(prisma, actor, input([{ productId: other.id, actualQty: 11 }]), new Date("2026-09-15T03:00:00Z"));
    await createStocktake(prisma, actor, input([{ productId: w.p.id, actualQty: 1 }]), new Date("2026-09-15T03:00:00Z"));
    await confirmStocktakeIdempotent(prisma, actor, "k", a.id);
    const l = await listStocktakes(prisma, actor, parseListParams({ status: "DONE" }, ["status"]));
    expect(l.rows.map((r) => r.id)).toEqual([a.id]); expect(l.stats).toMatchObject({ all: 2, draft: 1, done: 1, cancelled: 0 });
    expect((await getStocktake(prisma, { userId: w.userId, perms: new Set(["stocktake.manage"]) }, a.id)).lines[0]).not.toHaveProperty("unitCost");
  });
});
