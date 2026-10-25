// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickTimeFilter } from "@/components/ui/QuickTimeFilter";
import { parseListParams } from "@/lib/query-params";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); push.mockClear(); vi.unstubAllGlobals(); });
const now = new Date("2026-09-30T16:50:00Z");
async function open(params = {}) {
  render(<QuickTimeFilter basePath="/x?tab=report" params={parseListParams(params, ["status"])} now={now} />);
  await userEvent.click(screen.getByLabelText("Lọc nhanh theo thời gian"));
}

describe("QuickTimeFilter calendar dropdown", () => {
  it("uses an accessible bottom sheet on mobile", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    await open();
    expect(screen.getByRole("dialog", { name: "Khoảng thời gian" })).toBeVisible();
    await userEvent.click(screen.getByLabelText("Đóng bộ lọc ngày"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
  it("stages presets and preserves filters while resetting pagination on Apply", async () => {
    await open({ q: "ton", status: "active", sort: "-name", page: "4" });
    await userEvent.click(screen.getByRole("button", { name: "Tháng này" }));
    expect(push).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
    const url = new URL(push.mock.calls[0][0], "http://localhost");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ tab: "report", q: "ton", status: "active", sort: "-name", timePreset: "thisMonth" });
    expect(url.searchParams.has("page")).toBe(false);
  });
  it("selects an inclusive custom range across months", async () => {
    await open();
    await userEvent.click(screen.getByLabelText("28/09/2026"));
    expect(screen.getByRole("button", { name: "Áp dụng" })).toBeDisabled();
    await userEvent.click(screen.getByLabelText("Tháng sau"));
    await userEvent.click(screen.getByLabelText("03/10/2026"));
    expect(screen.getByLabelText("Từ ngày")).toHaveValue("2026-09-28");
    expect(screen.getByLabelText("Đến ngày")).toHaveValue("2026-10-03");
    await userEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
    expect(push).toHaveBeenCalledWith("/x?tab=report&timePreset=custom&timeStart=2026-09-28&timeEnd=2026-10-03");
  });
  it("blocks incomplete and reversed typed dates", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Từ ngày"), { target: { value: "2026-09-15" } });
    expect(screen.getByRole("button", { name: "Áp dụng" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Đến ngày"), { target: { value: "2026-09-01" } });
    expect(screen.getByRole("button", { name: "Áp dụng" })).toBeDisabled();
    expect(push).not.toHaveBeenCalled();
  });
  it("discards drafts on Escape and restores applied values on reopening", async () => {
    await open({ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15" });
    fireEvent.change(screen.getByLabelText("Từ ngày"), { target: { value: "2026-09-02" } });
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByLabelText("Lọc nhanh theo thời gian"));
    expect(screen.getByLabelText("Từ ngày")).toHaveValue("2026-09-01");
    expect(push).not.toHaveBeenCalled();
  });
  it("clears custom dates for all time", async () => {
    await open({ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15" });
    await userEvent.click(screen.getByRole("button", { name: "Mọi thời gian" }));
    await userEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
    expect(push).toHaveBeenCalledWith("/x?tab=report&timePreset=all");
  });
  it("uses ICT at month boundaries and supports parent filter drafts", async () => {
    const onChange = vi.fn();
    render(<QuickTimeFilter basePath="/x" params={parseListParams({ timePreset: "thisMonth" })} now={new Date("2026-09-30T17:00:00Z")} allowAll={false} onChange={onChange} />);
    expect(screen.getByTestId("time-range")).toHaveTextContent("01/10/2026 – 31/10/2026");
    await userEvent.click(screen.getByLabelText("Lọc nhanh theo thời gian"));
    expect(screen.queryByRole("button", { name: "Mọi thời gian" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Hôm nay" }));
    await userEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
    expect(onChange).toHaveBeenCalledWith({ timePreset: "today", timeStart: undefined, timeEnd: undefined });
    expect(push).not.toHaveBeenCalled();
  });
});
