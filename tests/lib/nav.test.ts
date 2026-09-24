import { describe, expect, it } from "vitest";
import type { NavModule } from "@/config/app.config";
import { buildNav, findActiveFunction, resolveBreadcrumb } from "@/lib/nav";

const nav: readonly NavModule[] = [
  { key: "home", label: "Trang chủ", icon: "home", type: "flat", path: "/", categories: [] },
  {
    key: "sales", label: "Bán hàng", icon: "shopping-cart", type: "accordion",
    categories: [
      {
        key: "orders", label: "Đơn hàng",
        functions: [
          { key: "order-list", label: "Danh sách đơn", desc: "", icon: "receipt", view: "table", path: "/sales/orders", codes: ["32"], perm: "order.view" },
          { key: "order-deleted", label: "Đơn đã xóa", desc: "", icon: "trash-2", view: "table", path: "/sales/orders/deleted", codes: ["34"], perm: "order.restore" },
          { key: "quote", label: "Báo giá", desc: "", icon: "file-text", view: "table", path: "/sales/quotes", codes: ["35"], perm: "quote.manage", planned: true },
        ],
      },
    ],
  },
  {
    key: "system", label: "Hệ thống", icon: "settings", type: "accordion",
    categories: [
      { key: "a", label: "A", functions: [{ key: "users", label: "Người dùng", desc: "", icon: "users", view: "table", path: "/system/users", codes: ["2"], perm: "user.view" }] },
    ],
  },
];

describe("buildNav", () => {
  it("ẩn HẲN chức năng không có quyền và chức năng planned", () => {
    const out = buildNav(nav, new Set(["order.view"]));
    const fns = out.flatMap((m) => m.categories.flatMap((c) => c.functions.map((f) => f.key)));
    expect(fns).toEqual(["order-list"]);
  });

  it("module accordion không còn chức năng nào hiển thị → biến mất; module flat luôn còn", () => {
    const out = buildNav(nav, new Set(["order.view"]));
    expect(out.map((m) => m.key)).toEqual(["home", "sales"]);
  });

  it("category rỗng bị bỏ", () => {
    const out = buildNav(nav, new Set(["user.view"]));
    expect(out.map((m) => m.key)).toEqual(["home", "system"]);
  });
});

describe("findActiveFunction — khớp tiền tố DÀI NHẤT", () => {
  it("/sales/orders/deleted → order-deleted (không phải order-list)", () => {
    const all = buildNav(nav, new Set(["order.view", "order.restore"]));
    expect(findActiveFunction(all, "/sales/orders/deleted")!.fn.key).toBe("order-deleted");
    expect(findActiveFunction(all, "/sales/orders/12")!.fn.key).toBe("order-list");
    expect(findActiveFunction(all, "/sales/ordersXYZ")).toBeNull();
    expect(findActiveFunction(all, "/khong-co")).toBeNull();
  });
});

describe("resolveBreadcrumb", () => {
  const all = buildNav(nav, new Set(["order.view", "user.view"]));
  it("danh sách", () => {
    expect(resolveBreadcrumb(all, "/system/users")).toEqual([
      { label: "Hệ thống", href: "/m/system" },
      { label: "Người dùng" },
    ]);
  });
  it("chi tiết & thêm mới", () => {
    expect(resolveBreadcrumb(all, "/system/users/12")).toEqual([
      { label: "Hệ thống", href: "/m/system" },
      { label: "Người dùng", href: "/system/users" },
      { label: "Chi tiết" },
    ]);
    expect(resolveBreadcrumb(all, "/system/users/new").at(-1)).toEqual({ label: "Thêm mới" });
  });
  it("trang chủ", () => {
    expect(resolveBreadcrumb(all, "/")).toEqual([{ label: "Trang chủ" }]);
  });
});
