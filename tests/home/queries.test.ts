import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_NAV } from "@/config/app.config";
import { buildNav } from "@/lib/nav";
import type { Actor } from "@/lib/permissions/scope";
import { homeWidgets, ictDayRange, loadWidget, lowStockCount, quickLinks, stockValueTotal, todayPurchaseCount, withTimeout } from "@/server/home/queries";
import type { WidgetSpec } from "@/server/home/types";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makePeriod, makeUser } from "../helpers/factories";
import { buy, engine, newWorld, T, useNoopCostOwners } from "../inventory/helpers";

const actor = (perms: string[]): Actor => ({ userId: 1, perms: new Set(perms) });
const NOW = new Date("2026-09-29T03:00:00Z"); // 10:00 ICT 29/09

describe("ictDayRange", () => {
  it("ngày ICT: 00:00 ICT = 17:00Z hôm trước; 23:59 ICT vẫn cùng ngày", () => {
    const { start, end } = ictDayRange(new Date("2026-09-29T16:59:59Z"));
    expect(start.toISOString()).toBe("2026-09-28T17:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-29T17:00:00.000Z");
    expect(ictDayRange(new Date("2026-09-29T17:00:00Z")).start.toISOString()).toBe("2026-09-29T17:00:00.000Z");
  });
});

describe("withTimeout / loadWidget", () => {
  it("quá hạn → reject; widget lỗi hoặc quá hạn trả { ok:false } chứ không ném và không phải 0", async () => {
    vi.useFakeTimers();
    const slow = withTimeout(new Promise(() => undefined), 50);
    const assertion = expect(slow).rejects.toThrow(/quá thời gian/);
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    vi.useRealTimers();

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad: WidgetSpec = { key: "x", label: "X", href: "/", format: "count", run: async () => { throw new Error("boom"); } };
    expect(await loadWidget(prisma, bad)).toEqual({ ok: false });
    expect(await loadWidget(prisma, { ...bad, run: async () => 5 })).toEqual({ ok: true, value: 5 });
  });
});

describe("homeWidgets — quyền kiểm ở server", () => {
  const nav = (perms: string[]) => buildNav(APP_NAV, new Set(perms));
  const keys = (perms: string[]) => homeWidgets(nav(perms), actor(perms), NOW).map((w) => w.key);

  it("không quyền → không widget; thiếu stock.view → không biết tồn/giá trị; thiếu cost.view → không có giá trị tồn", () => {
    expect(keys([])).toEqual([]);
    expect(keys(["purchase.view"])).toEqual(["purchase-today"]);
    expect(keys(["stock.view"])).toEqual(["low-stock"]);
    expect(keys(["cost.view"])).toEqual([]); // cost.view một mình không mở được màn tồn kho
    expect(keys(["stock.view", "cost.view", "purchase.view"])).toEqual(["purchase-today", "low-stock", "stock-value"]);
  });

  it("href widget lấy từ menu đã lọc; lối tắt không bao giờ chứa chức năng planned", () => {
    const all = ["stock.view", "cost.view", "purchase.view", "purchase.create", "product.view", "bom.manage", "company.manage", "order.view", "stocktake.manage"];
    const w = homeWidgets(nav(all), actor(all), NOW);
    expect(w.find((x) => x.key === "low-stock")!.href).toBe("/inventory/min-stock");
    const links = quickLinks(nav(all)).map((l) => l.href);
    expect(links).toEqual(expect.arrayContaining(["/purchase/orders/new", "/production/bom", "/system/company"]));
    expect(links).not.toContain("/inventory/stocktakes");
  });
});

describe("truy vấn số liệu (DB thật)", () => {
  beforeEach(resetDb);
  useNoopCostOwners();

  it("todayPurchaseCount: chỉ phiếu hôm nay (ICT), trong kỳ mở, chưa huỷ", async () => {
    const [period, user, supplier] = [await makePeriod(), await makeUser(), await makePartner({ isCustomer: false, isSupplier: true })];
    const mk = (code: string, at: string, over = {}) =>
      prisma.purchase.create({ data: { code, periodId: period.id, partnerId: supplier.id, at: new Date(at), createdBy: user.id, ...over } });
    await mk("PN1", "2026-09-28T17:00:00Z"); // 00:00 ICT 29/09 → tính
    await mk("PN2", "2026-09-29T16:59:00Z"); // 23:59 ICT 29/09 → tính
    await mk("PN3", "2026-09-28T16:59:00Z"); // 23:59 ICT 28/09 → không
    await mk("PN4", "2026-09-29T17:00:00Z"); // 00:00 ICT 30/09 → không
    await mk("PN5", "2026-09-29T03:00:00Z", { isCancelled: true }); // huỷ → không
    expect(await todayPurchaseCount(prisma, NOW)).toBe(2);
  });

  it("lowStockCount: đếm mã có định mức > 0 và tồn thấp hơn; stockValueTotal: tổng qtyRemaining × unitCost của kỳ mở", async () => {
    const w = await newWorld(3);
    const [low, ok, none] = w.products as [typeof w.p, typeof w.p, typeof w.p];
    await prisma.product.update({ where: { id: low.id }, data: { minStock: 10 } });
    await prisma.product.update({ where: { id: ok.id }, data: { minStock: 5 } });
    // `none` không đặt định mức → không bao giờ tính là dưới định mức
    const run = engine(w);
    await run([low.id], (ctx) => buy(ctx, low.id, 2, 100, T(0), 1));
    await run([ok.id], (ctx) => buy(ctx, ok.id, 8, 100, T(1), 2));
    await run([none.id], (ctx) => buy(ctx, none.id, 1, 100, T(2), 3));
    expect(await lowStockCount(prisma, actor(["stock.view"]))).toBe(1);
    expect(await stockValueTotal(prisma)).toBe("1100"); // (2 + 8 + 1) × 100
  });
});
