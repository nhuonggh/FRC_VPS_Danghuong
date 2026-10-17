// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportView } from "@/components/reports/ReportView";
import { parseListParams } from "@/lib/query-params";
import { REPORT_FILTER_KEYS, type ReportResult } from "@/server/reports/types";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const figures = { revenue: "190000", accum: "20000", cost: "40000", profit: "130000", margin: 68.4 };
const report: ReportResult & { range: { start: Date; end: Date } } = {
  key: "order-profit", title: "Lãi từng đơn", total: 1,
  columns: [{ key: "code", label: "Đơn", kind: "text" }, { key: "profit", label: "Lãi", kind: "money" }],
  rows: [{ id: 12, code: "DH000012", ...figures }], totals: figures,
  customers: [{ value: "7", label: "KH007 — Khách An" }],
  orderDetail: { id: 12, code: "DH000012", date: "2026-10-17", customer: "Khách An", figures, lines: [{ id: 1, code: "SP01", name: "Sản phẩm A", qty: "4", unit: "cái", price: "50000", discountNow: "10000", ...figures }] },
  range: { start: new Date("2026-10-01"), end: new Date("2026-11-01") },
};
describe("order profit report", () => {
  it("shows filtered totals and links to detail while preserving customer, search and time", () => {
    const params = parseListParams({ customer: "7", q: "DH", timePreset: "thisMonth" }, REPORT_FILTER_KEYS);
    render(<ReportView report={report} base="/reports/order-profit" params={params} />);
    const summary = screen.getByRole("region", { name: "Thống kê lãi từng đơn" });
    expect(within(summary).getByText("190.000 ₫")).toBeInTheDocument();
    expect(within(summary).getByText("130.000 ₫")).toBeInTheDocument();
    const href = screen.getByRole("link", { name: "Xem lãi lỗ đơn DH000012" }).getAttribute("href")!;
    const url = new URL(href, "https://example.test");
    expect(url.searchParams.get("order")).toBe("12");
    expect(url.searchParams.get("customer")).toBe("7");
    expect(url.searchParams.get("q")).toBe("DH");
    expect(url.searchParams.get("timePreset")).toBe("thisMonth");
    expect(screen.getByRole("link", { name: "Xuất Excel" }).getAttribute("href")).toContain("customer=7");
  });
  it("supports searchable customer filtering", async () => {
    render(<ReportView report={report} base="/reports/order-profit" params={parseListParams({})} />);
    await userEvent.click(screen.getByRole("button", { name: /^Khách hàng/ }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Tìm khách hàng" }), "Khách An");
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "KH007 — Khách An" }));
    expect(push.mock.calls.at(-1)?.[0]).toContain("customer=7");
  });
  it("opens line profit detail from URL and closes with Escape without losing filters", async () => {
    render(<ReportView report={report} base="/reports/order-profit" params={parseListParams({ order: "12", customer: "7" }, REPORT_FILTER_KEYS)} />);
    const panel = screen.getByRole("complementary", { name: "Chi tiết lãi lỗ đơn hàng" });
    expect(within(panel).getByText("SP01 — Sản phẩm A")).toBeInTheDocument();
    expect(within(panel).getAllByText("130.000 ₫")).toHaveLength(2);
    await userEvent.keyboard("{Escape}");
    expect(push).toHaveBeenLastCalledWith("/reports/order-profit?customer=7");
  });
});
