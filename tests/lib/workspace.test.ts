import { describe, expect, it } from "vitest";
import { APP_NAV } from "@/config/app.config";
import { buildNav } from "@/lib/nav";
import { FUNCTIONS_TAB, MAX_PINS, allPinned, emptyPrefs, moduleForPath, parsePrefs, prefsSchema, reorderPins, restoreHref, setActive, setSidebarCollapsed, tabsFor, togglePin } from "@/lib/workspace";

const nav = buildNav(APP_NAV, new Set(["*"].concat(APP_NAV.flatMap((m) => [m.perm, ...m.categories.flatMap((c) => c.functions.map((f) => f.perm))]).filter(Boolean) as string[])));
const sales = nav.find((m) => m.key === "sales")!;

describe("không gian làm việc theo tài khoản (logic thuần)", () => {
  it("ghim thêm vào cuối, ghim lại thì bỏ ghim; không ảnh hưởng module khác", () => {
    let p = togglePin(emptyPrefs(), "sales", "order-list"); p = togglePin(p, "sales", "quote-list"); p = togglePin(p, "inventory", "x");
    expect(p.modules.sales!.pinned).toEqual(["order-list", "quote-list"]);
    p = togglePin(p, "sales", "order-list");
    expect(p.modules.sales!.pinned).toEqual(["quote-list"]); expect(p.modules.inventory!.pinned).toEqual(["x"]);
  });

  it("giới hạn số tab ghim", () => {
    let p = emptyPrefs(); for (let i = 0; i < MAX_PINS + 5; i++) p = togglePin(p, "sales", `f${i}`);
    expect(p.modules.sales!.pinned).toHaveLength(MAX_PINS);
  });

  it("sắp xếp lại: khoá lạ bị bỏ, khoá thiếu giữ ở cuối, không nhân đôi", () => {
    let p = emptyPrefs(); for (const k of ["a", "b", "c"]) p = togglePin(p, "sales", k);
    expect(reorderPins(p, "sales", ["c", "a"]).modules.sales!.pinned).toEqual(["c", "a", "b"]);
    expect(reorderPins(p, "sales", ["zzz", "b", "b"]).modules.sales!.pinned).toEqual(["b", "a", "c"]);
  });

  it("tab: 'Chức năng' luôn đầu; ghim đúng thứ tự; tối đa MỘT tab tạm; chức năng ghim mà hết quyền/không tồn tại bị ẩn", () => {
    let p = togglePin(emptyPrefs(), "sales", "quote-list"); p = togglePin(p, "sales", "khong-ton-tai"); p = togglePin(p, "sales", "order-list");
    const tabs = tabsFor(sales, p, "customer-list");
    expect(tabs.map((t) => [t.kind, t.key])).toEqual([["functions", FUNCTIONS_TAB], ["pinned", "quote-list"], ["pinned", "order-list"], ["temp", "customer-list"]]);
    expect(tabs[0]!.href).toBe("/m/sales");
    expect(tabsFor(sales, p, "order-list").some((t) => t.kind === "temp")).toBe(false); // đang mở tab đã ghim ⇒ không có tab tạm
    expect(tabsFor(sales, p, null).filter((t) => t.kind === "temp")).toHaveLength(0);
  });

  it("nhận module từ đường dẫn: trang chức năng, trang con (chi tiết), trang Chức năng; không phải module accordion ⇒ null", () => {
    expect(moduleForPath(nav, "/sales/orders")!.fn!.key).toBe("order-list");
    expect(moduleForPath(nav, "/sales/orders/123")!.fn!.key).toBe("order-list");
    expect(moduleForPath(nav, "/sales/orders-deleted")!.fn!.key).toBe("order-deleted");
    expect(moduleForPath(nav, "/m/sales")).toMatchObject({ fn: null }); expect(moduleForPath(nav, "/m/khong-co")).toBeNull();
    expect(moduleForPath(nav, "/")).toBeNull();
  });

  it("quay lại module: mở chức năng đang làm dở nếu còn hợp lệ, ngược lại về trang Chức năng", () => {
    expect(restoreHref(sales, setActive(emptyPrefs(), "sales", "quote-list"))).toBe("/sales/quotes");
    expect(restoreHref(sales, setActive(emptyPrefs(), "sales", "da-bi-go"))).toBe("/m/sales");
    expect(restoreHref(sales, emptyPrefs())).toBe("/m/sales");
    expect(restoreHref(sales, setActive(setActive(emptyPrefs(), "sales", "quote-list"), "sales", undefined))).toBe("/m/sales");
  });

  it("Yêu thích toàn hệ thống gom tab ghim của nhiều module, bỏ cái không còn hợp lệ", () => {
    const other = nav.find((m) => m.type === "accordion" && m.key !== "sales")!; const otherFn = other.categories[0]!.functions[0]!;
    let p = togglePin(emptyPrefs(), "sales", "order-list"); p = togglePin(p, other.key, otherFn.key); p = togglePin(p, "sales", "xoa-roi");
    expect(allPinned(nav, p).map((x) => `${x.module.key}:${x.fn.key}`)).toEqual(["sales:order-list", `${other.key}:${otherFn.key}`]);
  });

  it("sidebar: đổi trạng thái thu gọn; giá trị không đổi trả về cùng tham chiếu (không ghi DB thừa)", () => {
    const p = setSidebarCollapsed(emptyPrefs(), true); expect(p.sidebarCollapsed).toBe(true); expect(setSidebarCollapsed(p, true)).toBe(p);
  });

  it("dữ liệu lưu hỏng/cũ ⇒ cấu hình mặc định; schema chặn khoá bậy", () => {
    expect(parsePrefs(null)).toEqual(emptyPrefs()); expect(parsePrefs({ v: 2 })).toEqual(emptyPrefs()); expect(parsePrefs("x")).toEqual(emptyPrefs());
    expect(prefsSchema.safeParse({ v: 1, modules: { "<script>": { pinned: [] } } }).success).toBe(false);
    expect(prefsSchema.safeParse({ v: 1, modules: { sales: { pinned: ["a/b"] } } }).success).toBe(false);
    expect(prefsSchema.safeParse({ v: 1, modules: { sales: { pinned: ["order-list"], active: "quote-list" } } }).success).toBe(true);
  });
});
