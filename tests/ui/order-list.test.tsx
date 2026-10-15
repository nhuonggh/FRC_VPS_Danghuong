// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrderListControls } from "@/components/sales/OrderListControls";
import { activeOrderTab } from "@/components/sales/order-list-config";
import { parseListParams } from "@/lib/query-params";
import { ORDER_FILTER_KEYS } from "@/server/sales/queries";
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
beforeEach(() => { vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
const counts = { all: 10, pending: 2, late: 1, delivered: 5, failed: 1, unpaid: 3 };
describe("order list reference interactions", () => {
  it("tabs clear conflicting status filters while preserving date and customer filters", () => {
    const params = parseListParams({ delivery: "DELIVERED", timePreset: "today", customer: "nguyen", page: "3" }, ORDER_FILTER_KEYS);
    render(<OrderListControls params={params} counts={counts} creators={[]} groups={[]} now={new Date()} />);
    const tabs = screen.getByRole("navigation", { name: "Trạng thái đơn hàng" });
    expect(within(tabs).getAllByRole("link")).toHaveLength(6);
    const target = new URL(within(tabs).getByRole("link", { name: /Chưa thanh toán/ }).getAttribute("href")!, "https://example.test");
    expect(target.searchParams.get("delivery")).toBeNull();
    expect(target.searchParams.get("payment")).toBe("UNPAID");
    expect(target.searchParams.get("customer")).toBe("nguyen");
    expect(target.searchParams.get("timePreset")).toBe("today");
    expect(target.searchParams.get("page")).toBeNull();
    expect(activeOrderTab(params)).toBe("delivered");
  });
  it("filter typing is staged until Apply", async () => {
    render(<OrderListControls params={parseListParams({})} counts={counts} creators={[]} groups={[]} now={new Date()} />);
    await userEvent.click(screen.getByRole("button", { name: "Bộ lọc" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Mã đơn hàng" }), "DH001");
    expect(push).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("code=DH001"));
  });
  it("mobile uses a bottom sheet, supports Escape, and discards unapplied changes", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<OrderListControls params={parseListParams({})} counts={counts} creators={[]} groups={[]} now={new Date()} />);
    await userEvent.click(screen.getByRole("button", { name: "Bộ lọc" }));
    expect(screen.getByRole("dialog", { name: "Bộ lọc đơn hàng" })).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Mã đơn hàng" }), "DH002");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
  it("customer group search remains usable inside the mobile dialog", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<OrderListControls params={parseListParams({})} counts={counts} creators={[]} groups={[{ value: "1", label: "Đại lý" }]} now={new Date()} />);
    await userEvent.click(screen.getByRole("button", { name: "Bộ lọc" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Nhóm khách hàng" }));
    await userEvent.click(await screen.findByRole("option", { name: "Đại lý" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("group=1"));
  });
});
