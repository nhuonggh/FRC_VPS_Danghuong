import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { editSaleOrderTx } from "@/server/sales/lifecycle";
import { saleOrderSchema } from "@/server/sales/schemas";
import { createDraftSaleOrderIdempotent, createSaleOrderIdempotent } from "@/server/sales/service";
import { getOrder, getOrderForEdit } from "@/server/sales/queries";
import { prisma, resetDb } from "../helpers/db";
import { makePartner } from "../helpers/factories";
import { buy, engine, newWorld, T, type World } from "../inventory/helpers";

const NOW = new Date("2026-09-15T03:00:00Z");
const FULL = ["order.create", "order.edit", "sale_price.view", "order.edit_price", "partner.view_all"];
let w: World; let actor: Actor; let customer: { id: number };
let n = 0;

const input = async (over: Record<string, unknown> = {}) => saleOrderSchema.parse({
  partnerId: customer.id, date: "2026-09-15", expectedDeliveryDate: "2026-09-15", note: "",
  lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 5, salePrice: 30_000, discountNow: 0, discountAccum: 0, processingTypeId: null }], ...over,
});

beforeEach(async () => {
  await resetDb();
  w = await newWorld(3);
  actor = { userId: w.userId, perms: new Set(FULL) };
  customer = await makePartner({ isCustomer: true });
});

describe("đơn bán: người bán / kho / thanh toán", () => {
  it("không gửi → người bán = người lập, thanh toán NONE, không kho", async () => {
    const o = await createSaleOrderIdempotent(prisma, actor, `k-${++n}`, await input(), NOW);
    const row = await prisma.saleOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(row).toMatchObject({ salesUserId: actor.userId, warehouseId: null, paymentMethod: "NONE" });
  });

  it("lưu đúng kho/hình thức; sửa đơn đổi được, bỏ trống thì giữ nguyên, null thì xoá", async () => {
    const wh = await prisma.warehouse.create({ data: { name: "Kho chính" } });
    const o = await createSaleOrderIdempotent(prisma, actor, `k-${++n}`, await input({ warehouseId: wh.id, paymentMethod: "CASH" }), NOW);
    expect(await prisma.saleOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ warehouseId: wh.id, paymentMethod: "CASH" });
    const detail = await getOrder(prisma, actor, o.id);
    expect(detail).toMatchObject({ warehouseName: "Kho chính", paymentMethod: "CASH" });
    const edit = await getOrderForEdit(prisma, actor, o.id);
    expect(edit.defaults).toMatchObject({ warehouseId: wh.id, paymentMethod: "CASH", salesUserId: actor.userId });

    const lines = edit.defaults.lines.map((l) => ({ ...l }));
    await editSaleOrderTx(prisma, actor, o.id, saleOrderSchema.parse({ ...edit.defaults, lines, paymentMethod: "TRANSFER", warehouseId: undefined, salesUserId: null }), NOW);
    expect(await prisma.saleOrder.findUniqueOrThrow({ where: { id: o.id } })).toMatchObject({ warehouseId: wh.id, paymentMethod: "TRANSFER", salesUserId: null });
  });

  it("từ chối kho đã tắt và người bán đã khoá", async () => {
    const off = await prisma.warehouse.create({ data: { name: "Kho cũ", isActive: false } });
    await expect(createSaleOrderIdempotent(prisma, actor, `k-${++n}`, await input({ warehouseId: off.id }), NOW)).rejects.toMatchObject({ status: 400 });
    const locked = await prisma.user.create({ data: { username: "locked1", passwordHash: "x", fullName: "Đã khoá", isLocked: true } });
    await expect(createSaleOrderIdempotent(prisma, actor, `k-${++n}`, await input({ salesUserId: locked.id }), NOW)).rejects.toMatchObject({ status: 400 });
  });
});

describe("lưu nháp đơn bán", () => {
  it("tạo đơn nháp: KHÔNG xuất kho, KHÔNG chiết khấu tích lũy; retry cùng khoá chỉ tạo 1 đơn", async () => {
    const run = engine(w);
    await run([w.p.id], (ctx) => buy(ctx, w.p.id, 100, 20_000, T(0), 1));
    const body = await input({ lines: [{ productId: w.p.id, unit: w.p.baseUnit, qty: 5, salePrice: 30_000, discountNow: 0, discountAccum: 1000, processingTypeId: null }] });
    const a = await createDraftSaleOrderIdempotent(prisma, actor, "draft-1", body, NOW);
    const b = await createDraftSaleOrderIdempotent(prisma, actor, "draft-1", body, NOW);
    expect(b.id).toBe(a.id);
    expect(await prisma.saleOrder.count()).toBe(1);
    const row = await prisma.saleOrder.findUniqueOrThrow({ where: { id: a.id }, include: { lines: true } });
    expect(row).toMatchObject({ isDraft: true, salesUserId: actor.userId });
    expect(row.lines).toHaveLength(1);
    expect(await prisma.stockLedger.count({ where: { docType: "SALE" } })).toBe(0);
    expect(await prisma.saleLineIssue.count()).toBe(0);
    expect(await prisma.discountLedger.count()).toBe(0);
  });

  it("thiếu quyền tạo đơn → 403", async () => {
    await expect(createDraftSaleOrderIdempotent(prisma, { userId: actor.userId, perms: new Set(["sale_price.view"]) }, "d2", await input(), NOW)).rejects.toMatchObject({ status: 403 });
  });
});
