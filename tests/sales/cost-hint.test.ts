import { beforeEach, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { makePartner } from "../helpers/factories";
import { newWorld, type World } from "../inventory/helpers";
import { createPurchaseIdempotent } from "@/server/purchase/service";
import { salePricing } from "@/server/sales/pricing";
import { resolveRolePermissions } from "@/lib/permissions/catalog";
import type { Actor } from "@/lib/permissions/scope";

let w: World, customer: number;
const at = new Date("2026-09-20T16:59:59Z");
const asActor = (perms: string[]): Actor => ({ userId: w.userId, perms: new Set(perms) });

beforeEach(async () => {
  await resetDb(); w = await newWorld(1);
  const supplier = (await makePartner({ isSupplier: true })).id;
  customer = (await makePartner({ isCustomer: true })).id;
  await createPurchaseIdempotent(prisma, asActor(["purchase.create", "purchase_price.view"]), "buy-1", { partnerId: supplier, date: "2026-09-15", freightCost: 0, note: "", lines: [{ productId: w.p.id, qty: 100, unit: "md", factor: 1, purchasePrice: 120, rollInfo: "" }] });
});

it("kế toán mặc định chỉ nhận một con số giá vốn tham khảo, không có nguồn/chi tiết", async () => {
  const perms = resolveRolePermissions("Kế toán");
  expect(perms.has("sale.cost_hint.view")).toBe(true);
  expect(perms.has("order.analysis.view")).toBe(false);
  const dto = await salePricing(prisma, { userId: w.userId, perms }, customer, w.p.id, null, at);
  expect(dto?.costReference).toBeUndefined();
  expect(dto?.lastPurchasePrice).toBeUndefined();
  expect(dto?.costHint).toEqual({ perBase: expect.any(String) });
  expect(Number(dto!.costHint!.perBase)).toBeGreaterThan(0);
  expect(JSON.stringify(dto!.costHint)).not.toMatch(/code|href|materials|components|alternatives/);
});

it("người có quyền phân tích đầy đủ vẫn nhận costReference, không nhận costHint", async () => {
  const dto = await salePricing(prisma, { userId: w.userId, perms: resolveRolePermissions("Giám đốc") }, customer, w.p.id, null, at);
  expect(dto?.costReference?.primary?.perBase).toBeTruthy();
  expect(dto?.costHint).toBeUndefined();
});

it("thiếu cả hai quyền thì không có thông tin giá vốn nào", async () => {
  const dto = await salePricing(prisma, asActor(["sale_price.view"]), customer, w.p.id, null, at);
  expect(dto?.costReference).toBeUndefined();
  expect(dto?.costHint).toBeUndefined();
});

it("chưa có giá nhập → costHint báo chưa đủ dữ liệu", async () => {
  const perms = resolveRolePermissions("Kế toán");
  const other = await prisma.product.create({ data: { code: "NOHINT", name: "Chưa nhập", baseUnit: "md", kind: "NVL" } as never });
  const dto = await salePricing(prisma, { userId: w.userId, perms }, customer, other.id, null, at);
  expect(dto?.costHint).toEqual({ perBase: null, message: expect.stringContaining("Chưa đủ dữ liệu") });
});
