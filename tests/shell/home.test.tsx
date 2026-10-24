// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { use } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/(app)/page";
import { WidgetCard } from "@/components/home/WidgetCard";
import type { SessionActor } from "@/server/auth/actor";

const requireActor = vi.fn();
const loadWidget = vi.fn();
const widgetPromises = new Map<string, Promise<unknown>>();
vi.mock("@/server/auth/session", () => ({ requireActor: (...a: unknown[]) => requireActor(...a) }));
// Trang chủ không chạm DB trong test này: số liệu widget được kiểm riêng ở tests/home/*
// Widget thật là server component async (Suspense, stream vào sau) — jsdom không chạy được; thay bằng bản dùng `use()` cùng loadWidget giả.
vi.mock("@/components/home/StreamedWidget", () => ({
  StreamedWidget: ({ spec }: { spec: { key: string } & Record<string, never> }) => {
    if (!widgetPromises.has(spec.key)) widgetPromises.set(spec.key, loadWidget({}, spec));
    return <WidgetCard spec={spec as never} state={use(widgetPromises.get(spec.key)!) as never} />;
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/home/queries", async (orig) => ({ ...(await orig<typeof import("@/server/home/queries")>()), loadWidget: (...a: unknown[]) => loadWidget(...a) }));
const moduleLinks = () => screen.queryAllByRole("link").filter((l) => l.getAttribute("href")?.startsWith("/m/"));

const actor = (perms: string[], fullName = "Trần Văn An"): SessionActor =>
  ({ userId: 1, username: "an", fullName, perms: new Set(perms), mustChangePassword: false, authMethod: "password" });

async function renderHome(search: Record<string, string> = {}) {
  const page = await HomePage({ searchParams: Promise.resolve(search) });
  await act(async () => { render(page); });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T03:00:00Z")); // 10:00 ICT
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  requireActor.mockReset();
  loadWidget.mockReset();
  widgetPromises.clear();
});
beforeEach(() => loadWidget.mockResolvedValue({ ok: true, value: 3 }));

describe("Trang chủ — Level 0 (module selector)", () => {
  it("chào theo giờ ICT + tên người dùng; chỉ thẻ module mà actor được vào, link /m/<key>", async () => {
    requireActor.mockResolvedValue(actor(["user.view", "audit.view"]));
    await renderHome();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Chào buổi sáng, Trần Văn An");
    const links = moduleLinks();
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/m/system");
    expect(within(links[0]!).getByText("Hệ thống")).toBeInTheDocument();
    expect(within(links[0]!).getByText("2 chức năng")).toBeInTheDocument(); // user.view + audit.view; role.manage bị ẩn
    expect(screen.queryByText("Kế toán")).toBeNull();
  });

  it("module chỉ có chức năng 'planned' bị ẩn (Hệ thống: user.view chưa có màn); Báo cáo và Kho hiện khi đã có màn thật", async () => {
    requireActor.mockResolvedValue(actor(["report.view", "stock.view", "user.view"]));
    await renderHome();
    expect(screen.getByText("Báo cáo")).toBeInTheDocument();
    expect(moduleLinks().some((l) => within(l).queryByText("Kho"))).toBe(true); // "Kho" còn xuất hiện ở tab tổng quan nên chỉ xét thẻ module
    expect(moduleLinks().length).toBeGreaterThanOrEqual(2);
  });

  it("không quyền nào → thông báo trống, không có thẻ", async () => {
    requireActor.mockResolvedValue(actor([]));
    await renderHome();
    expect(screen.queryAllByRole("link")).toHaveLength(2); // Hướng dẫn vẫn dùng được khi chưa được giao chức năng.
    expect(screen.getByRole("link", { name: "Theo chức năng" })).toHaveAttribute("href", "/guide");
    expect(screen.getByRole("link", { name: "Theo công việc của bạn" })).toHaveAttribute("href", "/guide?view=roles");
    expect(screen.queryByRole("region", { name: "Số liệu nhanh" })).toBeNull();
    expect(loadWidget).not.toHaveBeenCalled();
    expect(screen.getByText(/chưa được cấp quyền vào chức năng nào/)).toBeInTheDocument();
  });

  it("giờ chiều theo ICT dù máy chủ ở múi giờ khác (17:59 ICT = 10:59Z)", async () => {
    vi.setSystemTime(new Date("2026-09-24T10:59:00Z"));
    requireActor.mockResolvedValue(actor(["user.view"]));
    await renderHome();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Chào buổi chiều");
  });

  it("tự kiểm đăng nhập (layout không đủ)", async () => {
    requireActor.mockResolvedValue(actor(["user.view"]));
    await renderHome();
    expect(requireActor).toHaveBeenCalledTimes(1);
  });

  it("thủ kho: thấy widget số lượng dưới định mức, KHÔNG thấy giá trị tồn hay phiếu nhập", async () => {
    requireActor.mockResolvedValue(actor(["stock.view"]));
    await renderHome();
    expect(document.querySelector('[data-widget="low-stock"]')).not.toBeNull();
    expect(document.querySelector('[data-widget="stock-value"]')).toBeNull();
    expect(document.querySelector('[data-widget="purchase-today"]')).toBeNull();
  });

  it("có cost.view + purchase.view: đủ ba widget; link widget là màn đã mở", async () => {
    requireActor.mockResolvedValue(actor(["stock.view", "cost.view", "purchase.view"]));
    await renderHome();
    for (const k of ["low-stock", "stock-value", "purchase-today"]) expect(document.querySelector(`[data-widget="${k}"]`)).not.toBeNull();
    expect(screen.getByRole("link", { name: "Giá trị tồn kho: xem chi tiết" })).toHaveAttribute("href", "/inventory/stock");
  });

  it("một widget lỗi chỉ hiện 'Chưa tải được — Thử lại' cục bộ, không số 0 giả; lời chào và module vẫn hiện", async () => {
    requireActor.mockResolvedValue(actor(["stock.view", "purchase.view"]));
    loadWidget.mockImplementation(async (_db: unknown, spec: { key: string }) => (spec.key === "low-stock" ? { ok: false } : { ok: true, value: 7 }));
    await renderHome();
    const bad = document.querySelector('[data-widget="low-stock"]')!;
    expect(bad).toHaveTextContent("Chưa tải được");
    expect(bad.textContent).not.toMatch(/\b0\b/);
    expect(within(bad as HTMLElement).getByRole("button", { name: /Thử lại/ })).toBeInTheDocument();
    expect(document.querySelector('[data-widget="purchase-today"]')).toHaveTextContent("7");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Trần Văn An");
    expect(moduleLinks().length).toBeGreaterThan(0);
  });

  it("lối tắt đã chuyển lên nút 'Truy cập nhanh' ở header — trang chủ không còn khối chip", async () => {
    requireActor.mockResolvedValue(actor(["bom.manage", "company.manage", "order.view"]));
    await renderHome();
    expect(screen.queryByRole("region", { name: "Truy cập nhanh" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Định mức NVL/ })).toBeNull();
  });
});
