import { describe, expect, it } from "vitest";
import { APP_NAV } from "@/config/app.config";
import { buildNav } from "@/lib/nav";
import { DEFAULT_QUICK_KEYS, MAX_QUICK, emptyPrefs, isQuick, moveQuick, parsePrefs, resetQuick, resolveQuick, toggleQuick } from "@/lib/workspace";

const paths = (perms: string[], p = emptyPrefs()) => resolveQuick(buildNav(APP_NAV, new Set(perms)), p).map((x) => x.fn.path);

describe("truy cập nhanh (logic thuần)", () => {
  it("mặc định = bộ chức năng hay dùng, chỉ cái có quyền và đã mở (không planned)", () => {
    const all = ["stock.view", "cost.view", "purchase.view", "purchase.create", "product.view", "bom.manage", "company.manage", "order.view", "stocktake.manage"];
    expect(paths(all)).toEqual(expect.arrayContaining(["/purchase/orders/new", "/production/bom", "/system/company"]));
    expect(paths(all)).not.toContain("/inventory/stocktakes");
    expect(paths(["bom.manage", "company.manage", "order.view"])).toEqual(["/production/bom", "/system/company"]);
    expect(emptyPrefs().quickAccess).toBeUndefined();
    expect(DEFAULT_QUICK_KEYS).toContain("bom-list");
  });

  it("thêm/bỏ: lần sửa đầu chốt danh sách mặc định rồi mới sửa; bỏ hết được; thêm vào cuối", () => {
    let p = toggleQuick(emptyPrefs(), "bom-list");
    expect(p.quickAccess).toEqual(DEFAULT_QUICK_KEYS.filter((k) => k !== "bom-list"));
    p = toggleQuick(p, "quote-list");
    expect(p.quickAccess!.at(-1)).toBe("quote-list");
    expect(isQuick(p, "quote-list")).toBe(true);
    let none = emptyPrefs();
    for (const k of DEFAULT_QUICK_KEYS) none = toggleQuick(none, k);
    expect(none.quickAccess).toEqual([]);
  });

  it("giới hạn số mục; sắp xếp lên/xuống; không vượt biên; khôi phục mặc định", () => {
    const full = { ...emptyPrefs(), quickAccess: Array.from({ length: MAX_QUICK }, (_, i) => `f${i}`) };
    expect(toggleQuick(full, "moi")).toBe(full);
    const up = moveQuick(emptyPrefs(), "purchase-list", -1);
    expect(up.quickAccess!.slice(0, 2)).toEqual(["purchase-list", "purchase-new"]);
    expect(moveQuick(up, "purchase-list", -1)).toBe(up);
    expect(moveQuick(emptyPrefs(), "khong-co", 1).quickAccess).toBeUndefined();
    expect(resetQuick(up).quickAccess).toBeUndefined();
  });

  it("khoá không còn tồn tại bị bỏ qua khi hiển thị; dữ liệu lưu quá dài bị từ chối", () => {
    expect(paths(["bom.manage"], { ...emptyPrefs(), quickAccess: ["xoa-roi", "bom-list"] })).toEqual(["/production/bom"]);
    expect(parsePrefs({ v: 1, modules: {}, quickAccess: Array.from({ length: 30 }, (_, i) => `f${i}`) })).toEqual(emptyPrefs());
  });
});
