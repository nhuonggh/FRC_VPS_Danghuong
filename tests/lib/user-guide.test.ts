import { describe, expect, it } from "vitest";
import { APP_NAV } from "@/config/app.config";
import { GUIDE_ARTICLES, GUIDE_ROLES } from "@/config/user-guide";
import { buildNav, resolveBreadcrumb } from "@/lib/nav";
import { guideTopics, roleTasks, visibleGuideRoles } from "@/lib/user-guide";
import { moduleForPath } from "@/lib/workspace";
import { moduleGuideHref } from "@/lib/guide-links";

describe("hướng dẫn sử dụng — nội dung và quyền truy cập", () => {
  it("mọi chức năng đang mở đều có bài hướng dẫn với bước thực hiện và kết quả", () => {
    const functions = APP_NAV.flatMap((m) => m.categories.flatMap((c) => c.functions));
    const active = functions.filter((f) => !f.planned);
    expect(active.length).toBeGreaterThan(50);
    for (const fn of active) {
      expect(GUIDE_ARTICLES[fn.key], fn.key).toBeDefined();
      expect(GUIDE_ARTICLES[fn.key]!.steps.length, fn.key).toBeGreaterThanOrEqual(3);
      expect(GUIDE_ARTICLES[fn.key]!.result.length, fn.key).toBeGreaterThan(10);
    }
    expect(Object.keys(GUIDE_ARTICLES).sort()).toEqual(active.map((f) => f.key).sort());
  });
  it("không đưa Gia công thuê chưa triển khai vào bài hay danh sách theo vai trò", () => {
    expect(GUIDE_ARTICLES["processing-job"]).toBeUndefined();
    const functions = new Set(APP_NAV.flatMap((m) => m.categories.flatMap((c) => c.functions.filter((f) => !f.planned).map((f) => f.key))));
    for (const role of GUIDE_ROLES) for (const task of role.tasks) expect(functions.has(task.fn), task.fn).toBe(true);
  });
  it("chỉ tạo chủ đề, vai trò và đường dẫn thao tác theo menu đã lọc quyền", () => {
    const nav = buildNav(APP_NAV, new Set(["order.view"]));
    const sales = nav.find((m) => m.key === "sales")!;
    expect(guideTopics(sales).map(({ fn }) => fn.key)).toEqual(["order-list", "delivery-note-list"]);
    for (const role of visibleGuideRoles(nav)) for (const task of roleTasks(role, nav)) expect(task.href).toBe(moduleGuideHref("sales", "order-list"));
    expect(visibleGuideRoles(buildNav(APP_NAV, new Set()))).toEqual([]);
  });
  it("nhận đúng module và đường dẫn khi mở hướng dẫn trực tiếp", () => {
    const nav = buildNav(APP_NAV, new Set(["trip.manage"]));
    expect(moduleForPath(nav, moduleGuideHref("delivery"))?.module.key).toBe("delivery");
    expect(moduleForPath(nav, moduleGuideHref("sales"))).toBeNull();
    expect(resolveBreadcrumb(nav, moduleGuideHref("delivery"))).toEqual([
      { label: "Giao hàng", href: "/m/delivery" }, { label: "Hướng dẫn sử dụng" },
    ]);
    expect(resolveBreadcrumb(nav, "/guide").at(-1)?.label).toBe("Hướng dẫn sử dụng");
    expect(resolveBreadcrumb(nav, "/guide/roles/cashier").at(-1)?.label).toBe("Thủ quỹ");
  });
});
