// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import HomePage from "@/app/(app)/page";
import { DashboardView } from "@/components/home/dashboard/DashboardView";
import type { SessionActor } from "@/server/auth/actor";
import type { Dashboard } from "@/server/home/dashboard/types";

const requireActor = vi.fn();
const loadDashboard = vi.fn();
const push = vi.fn();
vi.mock("@/server/auth/session", () => ({ requireActor: (...a: unknown[]) => requireActor(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/server/home/dashboard", async (orig) => ({ ...(await orig<typeof import("@/server/home/dashboard")>()), loadDashboard: (...a: unknown[]) => loadDashboard(...a) }));
vi.mock("@/server/home/queries", async (orig) => ({ ...(await orig<typeof import("@/server/home/queries")>()), loadWidget: async () => ({ ok: true, value: 1 }) }));

const actor = (perms: string[]): SessionActor =>
  ({ userId: 1, username: "an", fullName: "An", perms: new Set(perms), mustChangePassword: false, authMethod: "password" });
const render_ = async (search: Record<string, string>) => render(await HomePage({ searchParams: Promise.resolve(search) }));

afterEach(() => { cleanup(); requireActor.mockReset(); loadDashboard.mockReset(); push.mockReset(); });

const SAMPLE: Dashboard = {
  kpis: [
    { key: "revenue", label: "Doanh thu bán hàng", value: 320500000, format: "currency", icon: "bar-chart-3", tone: "accent", delta: 12 },
    { key: "debt", label: "Công nợ phải thu", value: 132500000, format: "currency", icon: "hand-coins", tone: "danger", delta: 5, deltaInverted: true },
  ],
  widgets: [
    { key: "m", kind: "bars", title: "Doanh thu theo tháng", span: 8, labels: ["T1", "T2"], barFormat: "currency", bars: [{ name: "Doanh thu", values: [100, 0], tone: "accent" }], line: { name: "Số đơn", values: [3, -1], tone: "info" } },
    { key: "d", kind: "donut", title: "Cơ cấu", span: 4, format: "count", centerLabel: "đơn", centerValue: 10, slices: [{ label: "A", value: 6 }, { label: "B", value: 4 }] },
    { key: "r", kind: "rank", title: "Top", span: 4, format: "currency", items: [{ label: "Công ty ABC", value: 5, href: "/sales/customers/1" }] },
    { key: "t", kind: "table", title: "Đơn gần đây", span: 8, columns: [{ label: "Mã" }, { label: "Trạng thái" }], rows: [[{ text: "DH1", href: "/sales/orders/1" }, { text: "Đã giao", tone: "success" }]] },
    { key: "s", kind: "status", title: "Tình trạng", span: 6, items: [{ label: "Đang xử lý", value: 4, tone: "info", icon: "truck" }] },
    { key: "empty", kind: "table", title: "Trống", span: 6, columns: [{ label: "x" }], rows: [] },
  ],
  notes: ["Ghi chú cuối trang."],
};

describe("DashboardView", () => {
  it("vẽ KPI (delta đúng chiều: công nợ tăng là xấu), mọi loại widget, drill-down link, empty state cục bộ", () => {
    render(<DashboardView data={SAMPLE} />);
    expect(screen.getByText("320.500.000 ₫")).toBeInTheDocument();
    expect(screen.getByLabelText("Tăng 12% so với kỳ trước").className).toContain("text-success");
    expect(screen.getByLabelText("Tăng 5% so với kỳ trước").className).toContain("text-danger"); // deltaInverted
    expect(screen.getByRole("link", { name: "Công ty ABC" })).toHaveAttribute("href", "/sales/customers/1");
    expect(screen.getByRole("link", { name: "DH1" })).toHaveAttribute("href", "/sales/orders/1");
    expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(2); // bar + donut
    expect(within(document.querySelector('[data-widget="empty"]') as HTMLElement).getByText(/Chưa có dữ liệu/)).toBeInTheDocument();
    expect(screen.getByText("Ghi chú cuối trang.")).toBeInTheDocument();
  });
});

describe("Trang chủ — tab ngang tổng quan", () => {
  it("Kế toán mặc định hôm nay, phân biệt hậu kiểm với sao kê và mở đúng phiếu cần xử lý", async () => {
    requireActor.mockResolvedValue(actor(["cashbook.view", "receipt.manage"]));
    loadDashboard.mockResolvedValue({ ...SAMPLE, bankReceipts: {
      accounts: [{ id: 1, name: "MB", bankNo: "1234", recorded: "5000000", reviewed: 1, pending: 1, returned: 0, bookHref: "/accounting/bankbook?account=1" }],
      selectedAccount: null, recorded: "5000000", reviewed: 1, pending: 1, returned: 0,
      tasks: [{ id: 2, code: "PT002", at: "2026-10-14T03:00:00Z", partnerName: "Khách An", accountName: "MB", amount: "2000000", status: "PENDING_REVIEW", href: "/accounting/receipts/2" }],
      tasksHref: "/accounting/receipts?cashType=BANK", bookHref: "/accounting/bankbook",
    } });
    await render_({ tab: "accounting" });
    expect(screen.getByRole("button", { name: "Lọc nhanh theo thời gian" })).toHaveTextContent("Hôm nay");
    expect(loadDashboard).toHaveBeenCalledWith({}, expect.anything(), "accounting", { preset: "today", start: undefined, end: undefined, bankAccount: undefined, accountingSection: "bank" }, expect.any(Date));
    const bank = screen.getByRole("region", { name: "Kiểm tra tiền nhận ngân hàng" });
    expect(within(bank).getAllByText("Chưa có sao kê").length).toBeGreaterThan(0);
    expect(within(bank).getByText("Chưa xác nhận khớp với sao kê")).toBeInTheDocument();
    expect(within(bank).getByText("Khách An")).toBeInTheDocument();
    expect(within(bank).getByRole("link", { name: "PT002" })).toHaveAttribute("href", "/accounting/receipts/2");
    expect(screen.queryByRole("heading", { name: "Thu chi và công nợ" })).not.toBeInTheDocument();
    expect(screen.queryByText("Doanh thu bán hàng")).not.toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "Nhóm báo cáo kế toán" });
    expect(within(tabs).getAllByRole("link").map((l) => l.textContent)).toEqual(["Kiểm tra tiền ngân hàng", "Thu chi", "Số dư Quỹ"]);
    expect(within(tabs).getByRole("link", { name: "Kiểm tra tiền ngân hàng" })).toHaveAttribute("aria-current", "page");
    await userEvent.click(screen.getByRole("combobox", { name: "Tài khoản nhận tiền" }));
    await userEvent.click(await screen.findByRole("option", { name: /MB/ }));
    expect(push).toHaveBeenCalledWith("/?tab=accounting&accountingSection=bank&bankAccount=1&timePreset=today");
  });
  it.each(["cashflow", "debt", "funds"])("tab con %s có URL riêng và giữ bộ lọc khi chuyển nhóm", async (section) => {
    requireActor.mockResolvedValue(actor(["cashbook.view", "receipt.manage", "debt.view"]));
    loadDashboard.mockResolvedValue({ kpis: [], widgets: [] });
    await render_({ tab: "accounting", accountingSection: section, bankAccount: "3", timePreset: "custom", timeStart: "2026-10-01", timeEnd: "2026-10-14" });
    const tabs = screen.getByRole("navigation", { name: "Nhóm báo cáo kế toán" });
    expect(within(tabs).getAllByRole("link").map((l) => l.textContent)).toEqual(["Kiểm tra tiền ngân hàng", "Thu chi", "Công nợ", "Số dư Quỹ"]);
    expect(loadDashboard).toHaveBeenCalledWith({}, expect.anything(), "accounting", expect.objectContaining({ accountingSection: section }), expect.any(Date));
    const bankHref = new URL(within(tabs).getByRole("link", { name: "Kiểm tra tiền ngân hàng" }).getAttribute("href")!, "https://example.test");
    expect(bankHref.searchParams.get("bankAccount")).toBe("3");
    expect(bankHref.searchParams.get("timeStart")).toBe("2026-10-01");
    expect(bankHref.searchParams.get("timeEnd")).toBe("2026-10-14");
    expect(screen.queryByRole("button", { name: "Lọc nhanh theo thời gian" }) !== null).toBe(section === "cashflow");
    expect(screen.queryByRole("region", { name: "Kiểm tra tiền nhận ngân hàng" })).not.toBeInTheDocument();
  });
  it("người chỉ có quyền công nợ được đưa về tab Công nợ khi URL yêu cầu nhóm khác", async () => {
    requireActor.mockResolvedValue(actor(["debt.view"]));
    loadDashboard.mockResolvedValue({ kpis: [], widgets: [] });
    await render_({ tab: "accounting", accountingSection: "bank" });
    const tabs = screen.getByRole("navigation", { name: "Nhóm báo cáo kế toán" });
    expect(within(tabs).getAllByRole("link").map((l) => l.textContent)).toEqual(["Công nợ"]);
    expect(within(tabs).getByRole("link", { name: "Công nợ" })).toHaveAttribute("aria-current", "page");
    expect(loadDashboard).toHaveBeenCalledWith({}, expect.anything(), "accounting", expect.objectContaining({ accountingSection: "debt" }), expect.any(Date));
  });
  it("không có quyền tab nào → chỉ 'Chức năng', không thanh tab; ?tab= trái quyền rơi về Chức năng", async () => {
    requireActor.mockResolvedValue(actor(["user.view"]));
    await render_({ tab: "sales" });
    expect(screen.queryByRole("navigation", { name: "Tổng quan theo mục" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("An");
    expect(loadDashboard).not.toHaveBeenCalled(); // không truy vấn dashboard khi thiếu quyền
  });

  it("có quyền → thanh tab chỉ gồm tab được phép, đúng thứ tự, tab Chức năng là mặc định", async () => {
    requireActor.mockResolvedValue(actor(["order.view", "stock.view", "debt.view"]));
    await render_({});
    const nav = screen.getByRole("navigation", { name: "Tổng quan theo mục" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["Chức năng", "Kiểm tra hằng ngày", "Bán hàng", "Kho", "Kế toán"]);
    expect(within(nav).getByRole("link", { name: "Chức năng" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Bán hàng" })).toHaveAttribute("href", "/?tab=sales");
    expect(loadDashboard).not.toHaveBeenCalled(); // tab Chức năng không tải dashboard
  });

  it("?tab=sales (đủ quyền) → tiêu đề, bộ lọc thời gian không có 'Mọi thời gian', dữ liệu từ loader", async () => {
    requireActor.mockResolvedValue(actor(["order.view"]));
    loadDashboard.mockResolvedValue(SAMPLE);
    await render_({ tab: "sales" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tổng quan bán hàng");
    expect(screen.getByRole("link", { name: "Bán hàng" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Lọc nhanh theo thời gian" })).toHaveTextContent("Hôm nay");
    await userEvent.click(screen.getByRole("button", { name: "Lọc nhanh theo thời gian" }));
    expect(screen.queryByRole("button", { name: "Mọi thời gian" })).not.toBeInTheDocument();
    expect(loadDashboard).toHaveBeenCalledWith({}, expect.anything(), "sales", { preset: "today", start: undefined, end: undefined }, expect.any(Date));
  });

  it("loader lỗi → thông báo cục bộ, thanh tab vẫn dùng được", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    requireActor.mockResolvedValue(actor(["order.view"]));
    loadDashboard.mockRejectedValue(new Error("boom"));
    await render_({ tab: "sales" });
    expect(screen.getByRole("alert")).toHaveTextContent("Chưa tải được số liệu");
    expect(screen.getByRole("navigation", { name: "Tổng quan theo mục" })).toBeInTheDocument();
  });

  it("tab Kho (snapshot) không có bộ lọc thời gian", async () => {
    requireActor.mockResolvedValue(actor(["stock.view"]));
    loadDashboard.mockResolvedValue(SAMPLE);
    await render_({ tab: "inventory" });
    expect(screen.queryByRole("button", { name: "Lọc nhanh theo thời gian" })).not.toBeInTheDocument();
  });
});
