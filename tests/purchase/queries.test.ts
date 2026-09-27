import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { toIct } from "@/lib/time";
import { exportPurchasesXlsx } from "@/server/purchase/export";
import { getPurchase, listPurchases, PURCHASE_FILTER_KEYS } from "@/server/purchase/queries";
import { createPurchaseIdempotent } from "@/server/purchase/service";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makePeriod, makeProduct, makeUser } from "../helpers/factories";

const listParams = (values: Record<string, string> = {}) => parseListParams(values, PURCHASE_FILTER_KEYS);
const todayIct = () => {
  const now = toIct(new Date());
  return `${now.y}-${String(now.m + 1).padStart(2, "0")}-${String(now.d).padStart(2, "0")}`;
};

let writer: Actor;
let viewer: Actor;
let supplierId: number;
let productId: number;

beforeEach(async () => {
  await resetDb();
  const user = await makeUser({ fullName: "Kế toán A" });
  await makePeriod({ openedAt: new Date(Date.now() - 86_400_000) });
  const supplier = await makePartner({ code: "NCC001", name: "Tôn Hoa Sen", searchText: "ton hoa sen", isCustomer: false, isSupplier: true, isActive: true });
  const product = await makeProduct({ code: "TL045", name: "Tôn lạnh", baseUnit: "md", isActive: true });
  writer = { userId: user.id, perms: new Set(["purchase.view", "purchase.create", "purchase_price.view", "cost.view"]) };
  viewer = { userId: user.id, perms: new Set(["purchase.view"]) };
  supplierId = supplier.id;
  productId = product.id;
});

const create = (key: string) => createPurchaseIdempotent(prisma, writer, key, {
  partnerId: supplierId, date: todayIct(), freightCost: 1_000, note: "Giao sáng",
  lines: [{ productId, qty: 10, unit: "md", factor: 1, purchasePrice: 20_000, rollInfo: "Cuộn 1" }],
});

describe("purchase queries and export", () => {
  it("lists and details prices only to a user allowed to view them", async () => {
    const receipt = await create("query-1");
    const full = await getPurchase(prisma, writer, receipt.id);
    expect(full).toMatchObject({ code: "PN000001", purchaseTotal: "200000", freightCost: "1000" });
    expect(full.lines[0]).toMatchObject({ purchasePrice: "20000", allocatedFreight: "1000", unitCost: "20100" });

    const hidden = await getPurchase(prisma, viewer, receipt.id);
    expect(JSON.stringify(hidden)).not.toMatch(/purchaseTotal|freightCost|purchasePrice|purchaseAmount|allocatedFreight|unitCost/);
    expect((await listPurchases(prisma, viewer, listParams({ q: "hoa sen", sort: "-purchaseTotal" }))).rows).toHaveLength(1);
  });

  it("exports price columns only to a permitted user", async () => {
    await create("export-1");
    const headers = async (actor: Actor) => {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load((await exportPurchasesXlsx(prisma, actor, listParams())) as unknown as ArrayBuffer);
      return (workbook.worksheets[0]!.getRow(1).values as unknown[]).slice(1).map(String);
    };
    expect(await headers(writer)).toEqual(expect.arrayContaining(["Tổng tiền hàng", "Cước"]));
    expect(await headers(viewer)).not.toEqual(expect.arrayContaining(["Tổng tiền hàng", "Cước"]));
  });
});
