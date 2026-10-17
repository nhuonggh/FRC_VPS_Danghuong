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
function fixture(key: string): ReportResult & { range: { start: Date; end: Date } } {
  return { key, title: key, total: 1, columns: [{ key: "name", label: "Khoản mục", kind: "text" }], rows: [{ name: "Dữ liệu báo cáo" }], summary: [{ label: "Tổng số", value: 1 }, { label: "Lãi", value: "-12000", money: true, tone: "danger" }], notes: ["Ghi chú tính toán"], customers: [{ value: "8", label: "KH008 — Khách Bình" }], range: { start: new Date("2026-10-01"), end: new Date("2026-11-01") } };
}
describe("report summaries", () => {
  it.each(["period-pnl", "by-customer", "by-group", "issue-by-order", "production", "debt-reconciliation"])("renders summary above the data for %s", (key) => {
    render(<ReportView report={fixture(key)} params={parseListParams({})} base={`/reports/${key}`} />);
    const stats = screen.getByRole("region", { name: `Thống kê ${key}` });
    expect(within(stats).getByText("-12.000 ₫")).toHaveClass("text-danger");
    expect(stats.compareDocumentPosition(screen.getByRole("table")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    if (["period-pnl", "debt-reconciliation"].includes(key)) {
      const notes = screen.getByRole("region", { name: "Ghi chú báo cáo" });
      expect(screen.getByRole("table").compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
  it("customer filter keeps date and search, and exports the same selection", async () => {
    const params = parseListParams({ q: "Bình", timePreset: "thisMonth", customer: "8" }, REPORT_FILTER_KEYS);
    render(<ReportView report={fixture("by-customer")} params={params} base="/reports/by-customer" />);
    await userEvent.click(screen.getByRole("button", { name: /^Khách hàng/ }));
    expect(screen.getByRole("searchbox", { name: "Tìm khách hàng" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "KH008 — Khách Bình" }));
    const url = new URL(push.mock.calls.at(-1)![0], "https://example.test");
    expect(url.searchParams.get("q")).toBe("Bình");
    expect(url.searchParams.get("timePreset")).toBe("thisMonth");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("link", { name: "Xuất Excel" }).getAttribute("href")).toContain("customer=8");
  });
});
