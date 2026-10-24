// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavProgress, startNavProgress } from "@/components/shell/NavProgress";

vi.mock("next/navigation", () => ({ usePathname: () => "/sales/orders", useSearchParams: () => new URLSearchParams("") }));
afterEach(cleanup);

const bar = () => screen.getByRole("progressbar", { hidden: true });
describe("NavProgress", () => {
  it("chạy khi bấm link nội bộ sang trang khác", () => {
    render(<><NavProgress /><a href="/sales/quotes">Báo giá</a></>);
    expect(bar()).toHaveAttribute("data-state", "idle");
    fireEvent.click(screen.getByText("Báo giá"));
    expect(bar()).toHaveAttribute("data-state", "loading");
  });
  it("không chạy với link cùng trang, tab mới, file/API, link ngoài hoặc phím tắt mở tab", () => {
    window.history.pushState({}, "", "/sales/orders");
    render(<><NavProgress />
      <a href="/sales/orders">same</a><a href="/sales/quotes" target="_blank">blank</a><a href="/api/print/X/1/html">api</a>
      <a href="https://example.com/x">ext</a><a href="/sales/quotes">mod</a></>);
    for (const t of ["same", "blank", "api", "ext"]) { fireEvent.click(screen.getByText(t)); expect(bar()).toHaveAttribute("data-state", "idle"); }
    fireEvent.click(screen.getByText("mod"), { ctrlKey: true });
    expect(bar()).toHaveAttribute("data-state", "idle");
  });
  it("startNavProgress (bấm dòng, lọc, tìm kiếm) bật thanh, tự tắt nếu điều hướng không xảy ra", () => {
    vi.useFakeTimers();
    render(<NavProgress />);
    act(() => startNavProgress());
    expect(bar()).toHaveAttribute("data-state", "loading");
    act(() => { vi.advanceTimersByTime(15000); });
    expect(bar()).toHaveAttribute("data-state", "idle");
    vi.useRealTimers();
  });
});
