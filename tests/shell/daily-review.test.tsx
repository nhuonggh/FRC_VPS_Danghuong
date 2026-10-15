// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DailyCheckView } from "@/components/home/DailyCheckView";
import { ReportExportButton } from "@/components/home/dashboard/ReportExportButton";
import { DailyFilters } from "@/components/home/DailyFilters";
import { DAILY_ITEMS } from "@/server/home/daily-config";
import { parseListParams } from "@/lib/query-params";
import { loadDailyItem, loadDailySummary } from "@/server/home/daily";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));
vi.mock("@/server/home/daily", async (original) => ({ ...await original<typeof import("@/server/home/daily")>(), loadDailySummary: vi.fn(), loadDailyItem: vi.fn() }));

const actor = { userId: 1, perms: new Set(["return.manage", "sale_price.view"]) };
const params = parseListParams({ timePreset: "custom", timeStart: "2026-10-14", timeEnd: "2026-10-15" });
const now = new Date("2026-10-15T03:00:00Z");
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("daily review UI", () => {
  it("has three compact groups, eleven links keeping dates, export and explicit load failure", async () => {
    vi.mocked(loadDailySummary).mockResolvedValue(DAILY_ITEMS.map((item, i) => ({ item, totals: i === 0 ? null : { count: 0, cancelled: 0, amount: "0", extra: "0" } })));
    render(await DailyCheckView({ actor, params, now }));
    expect(screen.getByRole("heading", { name: "Kiểm tra hằng ngày" })).toBeInTheDocument();
    expect(screen.getAllByRole("region")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Xuất báo cáo" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Trả hàng theo đơn/ });
    expect(link).toHaveTextContent("Chưa tải được");
    expect(link.getAttribute("href")).toContain("item=return-order");
    expect(link.getAttribute("href")).toContain("timeStart=2026-10-14");
    expect(screen.queryByRole("img")).not.toBeInTheDocument(); // no charts in daily checklist
  });
  it("invalid custom range is actionable and does not query data", async () => {
    render(await DailyCheckView({ actor, params: parseListParams({ timePreset: "custom" }), now }));
    expect(screen.getByRole("alert")).toHaveTextContent("ngày bắt đầu");
    expect(loadDailySummary).not.toHaveBeenCalled();
  });
  it("detail failures show retry rather than zero or an empty list", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(loadDailyItem).mockRejectedValue(new Error("DB offline"));
    render(await DailyCheckView({ actor, params, now, itemKey: "return-order" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Chưa tải được");
    expect(screen.getByRole("button", { name: "Cập nhật số liệu" })).toBeInTheDocument();
    vi.mocked(console.error).mockRestore();
  });
  it("mobile filter stages changes until Apply and Escape closes the sheet", async () => {
    render(<DailyFilters basePath="/?tab=daily&item=loss" params={{ ...params, q: "HH", filters: { state: ["active"], type: ["LOSS"] } }} itemKey="loss" now={now} />);
    await userEvent.click(screen.getByRole("button", { name: /Bộ lọc ·/ }));
    expect(screen.getByRole("dialog", { name: "Lọc báo cáo" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Xuất hủy" }));
    expect(push).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("type=LOSS%2CWRITE_OFF"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("q=HH"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Bộ lọc ·/ }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("disables export while waiting, then displays server error clearly", async () => {
    let complete!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => { complete = resolve; }));
    vi.stubGlobal("fetch", fetcher);
    render(<ReportExportButton href="/api/home/daily/export?timePreset=today" />);
    await userEvent.click(screen.getByRole("button", { name: "Xuất báo cáo" }));
    expect(screen.getByRole("button", { name: "Đang xuất…" })).toBeDisabled();
    complete({ ok: false, json: async () => ({ error: "Hãy thu hẹp khoảng ngày rồi xuất lại." }) } as Response);
    expect(await screen.findByRole("alert")).toHaveTextContent("thu hẹp khoảng ngày");
    expect(screen.getByRole("button", { name: "Xuất báo cáo" })).toBeEnabled();
  });
});
