// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickTimeFilter } from "@/components/ui/QuickTimeFilter";
import { parseListParams, type ListParams } from "@/lib/query-params";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/x" }));
afterEach(() => { cleanup(); push.mockClear(); });

const NOW = new Date("2026-09-30T16:50:00Z");
const select = () => screen.getByLabelText("Lọc nhanh theo thời gian");

describe("QuickTimeFilter", () => {
  it("có đủ 10 mốc + 'Mọi thời gian'", () => {
    render(<QuickTimeFilter basePath="/x" params={parseListParams({})} now={NOW} />);
    const opts = screen.getAllByRole("option").map((o) => o.textContent);
    expect(opts).toEqual(["Mọi thời gian", "Hôm nay", "Tuần này", "Tháng này", "Quý này", "Tuần trước", "Tháng trước", "Quý trước", "Năm nay", "Năm trước", "Tùy chọn"]);
  });

  it("chọn mốc → đẩy URL (timePreset), về trang 1", async () => {
    render(<QuickTimeFilter basePath="/x" params={parseListParams({ page: "3" })} now={NOW} />);
    await userEvent.selectOptions(select(), "thisMonth");
    expect(push).toHaveBeenCalledWith("/x?timePreset=thisMonth");
  });

  it("chọn mốc giữ nguyên tìm kiếm/lọc/sort đang có", async () => {
    render(<QuickTimeFilter basePath="/x" params={parseListParams({ q: "ton", status: "a,b", sort: "-name", page: "4" }, ["status"])} now={NOW} />);
    await userEvent.selectOptions(select(), "today");
    expect(push).toHaveBeenCalledWith("/x?q=ton&status=a%2Cb&sort=-name&timePreset=today");
  });

  it("'Mọi thời gian' xoá mốc và cả 2 ngày tuỳ chọn", async () => {
    render(<QuickTimeFilter basePath="/x" params={parseListParams({ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15", q: "a" })} now={NOW} />);
    await userEvent.selectOptions(select(), "");
    expect(push).toHaveBeenCalledWith("/x?q=a");
  });

  it("đổi từ 'Tùy chọn' sang mốc cố định thì bỏ timeStart/timeEnd", async () => {
    render(<QuickTimeFilter basePath="/x" params={parseListParams({ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15" })} now={NOW} />);
    await userEvent.selectOptions(select(), "lastMonth");
    expect(push).toHaveBeenCalledWith("/x?timePreset=lastMonth");
  });

  it("hiện khoảng ngày theo ICT: 23:50 ICT 30/09 → Tháng này = 01/09/2026 – 30/09/2026", () => {
    render(<QuickTimeFilter basePath="/x" params={parseListParams({ timePreset: "thisMonth" })} now={NOW} />);
    expect(screen.getByTestId("time-range")).toHaveTextContent("01/09/2026 – 30/09/2026");
  });

  it("hiện khoảng ngày đúng ở ranh giới: 00:00 ICT 01/10 → Tháng này = 01/10 – 31/10; Hôm nay = 1 ngày", () => {
    const edge = new Date("2026-09-30T17:00:00Z");
    const { unmount } = render(<QuickTimeFilter basePath="/x" params={parseListParams({ timePreset: "thisMonth" })} now={edge} />);
    expect(screen.getByTestId("time-range")).toHaveTextContent("01/10/2026 – 31/10/2026");
    unmount();
    render(<QuickTimeFilter basePath="/x" params={parseListParams({ timePreset: "today" })} now={NOW} />);
    expect(screen.getByTestId("time-range")).toHaveTextContent("30/09/2026 – 30/09/2026");
  });

  it("Tuần này hiện Thứ Hai → Chủ nhật; Quý trước qua ranh giới năm", () => {
    render(<QuickTimeFilter basePath="/x" params={parseListParams({ timePreset: "thisWeek" })} now={NOW} />);
    expect(screen.getByTestId("time-range")).toHaveTextContent("28/09/2026 – 04/10/2026");
    cleanup();
    render(<QuickTimeFilter basePath="/x" params={parseListParams({ timePreset: "lastQuarter" })} now={new Date("2026-02-10T05:00:00Z")} />);
    expect(screen.getByTestId("time-range")).toHaveTextContent("01/10/2025 – 31/12/2025");
  });

  it("chưa chọn mốc → không hiện khoảng ngày và không có ô ngày", () => {
    render(<QuickTimeFilter basePath="/x" params={parseListParams({})} now={NOW} />);
    expect(screen.queryByTestId("time-range")).toBeNull();
    expect(screen.queryByLabelText("Từ ngày")).toBeNull();
  });

  it("Tùy chọn hiện 2 ô ngày", () => {
    render(<QuickTimeFilter basePath="/x" params={parseListParams({ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15" })} now={NOW} />);
    expect(screen.getByLabelText("Từ ngày")).toHaveValue("2026-09-01");
    expect(screen.getByLabelText("Đến ngày")).toHaveValue("2026-09-15");
    expect(screen.getByTestId("time-range")).toHaveTextContent("01/09/2026 – 15/09/2026");
  });

  it("Tùy chọn chưa đủ/đảo ngược → không hiện khoảng ngày, báo cho người dùng (server sẽ không lọc thời gian)", () => {
    const { unmount } = render(<QuickTimeFilter basePath="/x" params={parseListParams({ timePreset: "custom", timeStart: "2026-09-01" })} now={NOW} />);
    expect(screen.queryByTestId("time-range")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Chọn đủ 2 ngày");
    unmount();
    render(<QuickTimeFilter basePath="/x" params={parseListParams({ timePreset: "custom", timeStart: "2026-09-15", timeEnd: "2026-09-01" })} now={NOW} />);
    expect(screen.queryByTestId("time-range")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("không sau ngày kết thúc");
  });
});
