// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastHost } from "@/components/ui/Toast";
import { toast, useToastStore } from "@/lib/toast";

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.setState({ items: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toast", () => {
  it("success tự tắt sau 4 giây", () => {
    render(<ToastHost />);
    act(() => { toast.success("Đã lưu thay đổi."); });
    expect(screen.getByText("Đã lưu thay đổi.")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3900); });
    expect(screen.getByText("Đã lưu thay đổi.")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText("Đã lưu thay đổi.")).toBeNull();
  });

  it("info cũng tự tắt sau 4 giây", () => {
    render(<ToastHost />);
    act(() => { toast.info("Đang đồng bộ."); });
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.queryByText("Đang đồng bộ.")).toBeNull();
  });

  it("error KHÔNG tự tắt; đóng tay bằng nút X", () => {
    render(<ToastHost />);
    act(() => { toast.error("Không lưu được."); });
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText("Không lưu được.")).toBeInTheDocument();
    act(() => { screen.getByRole("button", { name: "Đóng thông báo" }).click(); });
    expect(screen.queryByText("Không lưu được.")).toBeNull();
  });

  it("mọi loại toast (kể cả success) đều có nút X đóng tay", () => {
    render(<ToastHost />);
    act(() => { toast.success("Xong"); });
    act(() => { screen.getByRole("button", { name: "Đóng thông báo" }).click(); });
    expect(screen.queryByText("Xong")).toBeNull();
  });

  it("tối đa 3 toast, phần còn lại gộp '+N thông báo khác'", () => {
    render(<ToastHost />);
    act(() => { ["a", "b", "c", "d", "e"].forEach((m) => toast.error(m)); });
    expect(screen.getAllByRole("alert")).toHaveLength(3);
    expect(screen.getByText("+2 thông báo khác")).toBeInTheDocument();
    // 3 toast MỚI NHẤT hiển thị, cũ nhất bị gộp
    expect(screen.queryByText("a")).toBeNull();
    expect(screen.getByText("e")).toBeInTheDocument();
  });

  it("đóng bớt 1 toast → toast bị gộp hiện lại, bộ đếm giảm", () => {
    render(<ToastHost />);
    act(() => { ["a", "b", "c", "d"].forEach((m) => toast.error(m)); });
    expect(screen.getByText("+1 thông báo khác")).toBeInTheDocument();
    act(() => { screen.getAllByRole("button", { name: "Đóng thông báo" })[0]!.click(); });
    expect(screen.queryByText(/thông báo khác/)).toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(3);
  });

  it("toast kèm hành động (Hoàn tác) gọi callback rồi tự đóng", () => {
    render(<ToastHost />);
    const undo = vi.fn();
    act(() => { toast.success("Đã xóa", { label: "Hoàn tác", onClick: undo }); });
    act(() => { screen.getByRole("button", { name: "Hoàn tác" }).click(); });
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText("Đã xóa")).toBeNull();
  });

  it("màu theo loại dùng token (viền trái 3px)", () => {
    render(<ToastHost />);
    act(() => { toast.error("E"); toast.warning("W"); });
    expect(screen.getByText("E").closest("[role=alert]")!.className).toContain("border-danger");
    expect(screen.getByText("W").closest("[role=status]")!.className).toContain("border-warning");
  });

  it("a11y: lỗi = role=alert (assertive), success/info/warning = role=status (polite)", () => {
    render(<ToastHost />);
    act(() => { toast.error("E"); toast.success("S"); toast.info("I"); }); // tối đa 3 hiển thị
    expect(screen.getByText("E").closest("[role]")).toHaveAttribute("role", "alert");
    for (const m of ["S", "I"]) expect(screen.getByText(m).closest("[role]")).toHaveAttribute("role", "status");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getAllByRole("status")).toHaveLength(2);
  });

  it("a11y: vùng live (aria-live=polite) có sẵn từ đầu và là CÙNG 1 phần tử khi toast xuất hiện → đọc tin cậy", () => {
    const { container } = render(<ToastHost />);
    const region = container.querySelector("[aria-live]");
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-relevant", "additions");
    act(() => { toast.success("Xong"); });
    expect(container.querySelector("[aria-live]")).toBe(region);
    expect(region).toContainElement(screen.getByText("Xong"));
  });
});
