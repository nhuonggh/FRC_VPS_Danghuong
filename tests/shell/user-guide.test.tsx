// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuideIndex, ModuleGuide, RoleGuide } from "@/components/guide/GuideViews";
import { GuideHomeSection } from "@/components/guide/GuideHomeSection";
import { APP_NAV } from "@/config/app.config";
import { GUIDE_ROLES } from "@/config/user-guide";
import { buildNav } from "@/lib/nav";
import ModuleGuidePage from "@/app/(app)/guide/modules/[module]/page";
import GuidePage from "@/app/(app)/guide/page";
import RoleGuidePage from "@/app/(app)/guide/roles/[role]/page";

const { requireActor, notFound } = vi.hoisted(() => ({ requireActor: vi.fn(), notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }) }));
vi.mock("@/server/auth/session", () => ({ requireActor }));
vi.mock("next/navigation", () => ({ notFound }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const nav = buildNav(APP_NAV, new Set(["order.view", "trip.manage"]));

describe("hướng dẫn sử dụng — màn hình và đường vào", () => {
  it("trang chủ có hai cách mở hướng dẫn", () => {
    render(<GuideHomeSection />);
    expect(screen.getByRole("link", { name: "Theo chức năng" })).toHaveAttribute("href", "/guide");
    expect(screen.getByRole("link", { name: "Theo công việc của bạn" })).toHaveAttribute("href", "/guide?view=roles");
  });
  it("mục lục chỉ hiện nhóm được giao; hai cách đọc có địa chỉ riêng", () => {
    render(<GuideIndex nav={nav} byRole={false} />);
    expect(screen.getByRole("link", { name: "Giao hàng" })).toHaveAttribute("href", "/guide/modules/delivery");
    expect(screen.queryByRole("link", { name: "Hệ thống" })).toBeNull();
    expect(screen.getByRole("link", { name: "Theo chức năng" })).toHaveAttribute("aria-current", "page");
  });
  it("đọc đúng bài được liên kết, mở đúng màn hình và có thể quay lại module", () => {
    render(<ModuleGuide module={nav.find((m) => m.key === "delivery")!} topic="trip-result" />);
    expect(screen.getByRole("heading", { level: 2, name: "Nhập kết quả giao" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Mở Nhập kết quả giao" })).toHaveAttribute("href", "/delivery/results");
    expect(screen.getByRole("link", { name: "Quay lại Giao hàng" })).toHaveAttribute("href", "/m/delivery");
    expect(screen.getByRole("heading", { name: "Làm xong thì thấy gì?" })).toBeInTheDocument();
  });
  it("chủ đề không còn quyền trở về bài đầu được xem, không có đường mở chức năng bị ẩn", () => {
    render(<ModuleGuide module={nav.find((m) => m.key === "sales")!} topic="order-new" />);
    expect(screen.getByRole("heading", { level: 2, name: "Danh sách đơn" })).toBeInTheDocument();
    expect(document.querySelector('a[href="/sales/orders/new"]')).toBeNull();
  });
  it("vai trò dùng chung bài theo chức năng và lọc việc không được giao", () => {
    render(<RoleGuide role={GUIDE_ROLES.find((r) => r.key === "sales")!} nav={nav} />);
    expect(screen.getByRole("link", { name: /Theo dõi giao hàng và thanh toán/ })).toHaveAttribute("href", "/guide/modules/sales?topic=order-list");
    expect(screen.queryByRole("link", { name: /Lập đơn khi khách chốt mua/ })).toBeNull();
  });
  it("trang tự kiểm đăng nhập và từ chối module không được giao kể cả khi gõ địa chỉ trực tiếp", async () => {
    requireActor.mockResolvedValue({ perms: new Set(["order.view"]) });
    await expect(ModuleGuidePage({ params: Promise.resolve({ module: "system" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    expect(requireActor).toHaveBeenCalledTimes(1);
    expect(notFound).toHaveBeenCalledTimes(1);
  });
  it("đường vào theo vai trò được giữ sau tải lại; vai trò sai có trang không tìm thấy", async () => {
    requireActor.mockResolvedValue({ perms: new Set(["order.view"]) });
    render(await GuidePage({ searchParams: Promise.resolve({ view: "roles" }) }));
    expect(screen.getByRole("link", { name: "Theo công việc của bạn" })).toHaveAttribute("aria-current", "page");
    await expect(RoleGuidePage({ params: Promise.resolve({ role: "khong-co" }) })).rejects.toThrow("NOT_FOUND");
  });
});
