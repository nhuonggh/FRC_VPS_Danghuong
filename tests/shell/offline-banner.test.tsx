// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineBanner } from "@/components/shell/OfflineBanner";

const TEXT = "Mất kết nối mạng — đang thử kết nối lại…";

function setOnLine(value: boolean) {
  vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(value);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OfflineBanner", () => {
  it("có mạng: vùng thông báo (role=status) có sẵn nhưng rỗng; mất mạng → banner cố định; có mạng lại → ẩn", () => {
    setOnLine(true);
    render(<OfflineBanner />);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(screen.getByRole("status")).toHaveTextContent(TEXT);
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("mở trang khi đã mất mạng (navigator.onLine=false) → hiện ngay sau khi mount", () => {
    setOnLine(false);
    render(<OfflineBanner />);
    expect(screen.getByRole("status")).toHaveTextContent(TEXT);
  });

  it("vùng role=status là vùng live nằm ngoài luồng bố cục → không đẩy nội dung (không layout shift)", () => {
    setOnLine(true);
    const { container } = render(<OfflineBanner />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("relative");
    expect(wrapper.className).toContain("h-0");
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(region.className).toContain("absolute");
  });

  it("gỡ listener khi unmount", () => {
    setOnLine(true);
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<OfflineBanner />);
    unmount();
    for (const ev of ["online", "offline"]) {
      expect(add.mock.calls.some((c) => c[0] === ev)).toBe(true);
      expect(remove.mock.calls.some((c) => c[0] === ev)).toBe(true);
    }
  });
});
