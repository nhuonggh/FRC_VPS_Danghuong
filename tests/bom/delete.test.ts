import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { deleteBoms } from "@/server/bom/service";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createSaleOrderIdempotent } from "@/server/sales/service";
import { prisma, resetDb } from "../helpers/db";
import { makeBomVersion, makePartner, makeProcessingType, makeProduct } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

const SALE_PERMS = ["order.analysis.view", "order.create", "sale_price.view", "cost.view", "order.edit_price", "partner.view_all", "order.view"];
let w: World; let director: Actor;
let fg: { id: number; baseUnit: string }; let m1: { id: number }; let pt: { id: number }; let pt2: { id: number };
const del = (actor: Actor, ids: number[]) => prisma.$transaction((tx) => deleteBoms(tx, actor, ids));
const bomIdOf = async (processingTypeId: number) => (await prisma.bom.findFirstOrThrow({ where: { productId: fg.id, processingTypeId } })).id;

beforeEach(async () => {
  await resetDb();
  w = await newWorld(1);
  director = { userId: w.userId, perms: new Set(["bom.manage", "bom.delete"]) };
  fg = await makeProduct({ kind: "THANH_PHAM" }); m1 = await makeProduct({ kind: "NVL" });
  pt = await makeProcessingType("Tôn xốp"); pt2 = await makeProcessingType("Tôn lạnh");
  for (const t of [pt, pt2]) {
    await makeBomVersion({ productId: fg.id, processingTypeId: t.id, createdBy: w.userId, validFrom: "2026-09-01", lines: [{ materialProductId: m1.id, qtyPerUnit: "1.2" }] });
    await makeBomVersion({ productId: fg.id, processingTypeId: t.id, createdBy: w.userId, validFrom: "2026-10-01", lines: [{ materialProductId: m1.id, qtyPerUnit: "2" }] });
  }
});

describe("deleteBoms", () => {
  it("xóa hẳn định mức cùng phiên bản + dòng NVL, định mức khác giữ nguyên", async () => {
    const id = await bomIdOf(pt.id);
    expect(await del(director, [id])).toEqual({ deleted: 1 });
    expect(await prisma.bom.count({ where: { id } })).toBe(0);
    expect(await prisma.bomVersion.count({ where: { bomId: id } })).toBe(0);
    expect(await prisma.bom.count()).toBe(1);
    expect(await prisma.bomVersion.count()).toBe(2);
    expect(await prisma.bomLine.count()).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "bom.delete", entityId: String(id) } })).toBe(1);
  });

  it("xóa hàng loạt nhiều định mức một lần", async () => {
    expect(await del(director, [await bomIdOf(pt.id), await bomIdOf(pt2.id)])).toEqual({ deleted: 2 });
    expect(await prisma.bom.count()).toBe(0);
    expect(await prisma.bomLine.count()).toBe(0);
  });

  it("thiếu quyền bom.delete (kể cả có bom.manage) ⇒ 403, không xóa gì", async () => {
    const id = await bomIdOf(pt.id);
    await expect(del({ userId: w.userId, perms: new Set(["bom.manage"]) }, [id])).rejects.toMatchObject({ status: 403 });
    expect(await prisma.bom.count()).toBe(2);
  });

  it("id không tồn tại ⇒ 404, không xóa gì", async () => {
    await expect(del(director, [await bomIdOf(pt.id), 999_999])).rejects.toMatchObject({ status: 404 });
    expect(await prisma.bom.count()).toBe(2);
  });

  it("định mức đã dùng trên đơn bán ⇒ 409 BOM_IN_USE nêu tên, KHÔNG xóa cả định mức chưa dùng đi cùng", async () => {
    await engine(w)([m1.id], (ctx) => buy(ctx, m1.id, 100, 10_000, T(0), 1));
    const customer = await makePartner({ isCustomer: true });
    const seller: Actor = { userId: w.userId, perms: new Set(SALE_PERMS) };
    await createSaleOrderIdempotent(prisma, seller, "k-1", saleOrderSchema.parse({
      partnerId: customer.id, date: "2026-09-30", expectedDeliveryDate: "2026-09-30", note: "",
      lines: [{ productId: fg.id, unit: fg.baseUnit, qty: 1, salePrice: 50_000, discountNow: 0, discountAccum: 0, processingTypeId: pt.id }],
    }), new Date("2026-09-30T03:00:00Z"));
    const used = await bomIdOf(pt.id); const free = await bomIdOf(pt2.id);
    const err = await del(director, [used, free]).catch((e) => e);
    expect(err).toMatchObject({ status: 409, code: "BOM_IN_USE" });
    expect(err.message).toContain("Tôn xốp");
    expect(err.message).toContain("1/2 định mức");
    expect(await prisma.bom.count()).toBe(2);
    expect(await del(director, [free])).toEqual({ deleted: 1 });
  });
});
