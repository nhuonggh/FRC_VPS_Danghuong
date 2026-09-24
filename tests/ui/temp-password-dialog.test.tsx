// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TempPasswordDialog } from "@/components/ui/TempPasswordDialog";

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

beforeEach(() => { toastSuccess.mockReset(); toastError.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setup(over: Partial<React.ComponentProps<typeof TempPasswordDialog>> = {}) {
  const onClose = vi.fn();
  render(<TempPasswordDialog open username="nam" password="Ab3dEfGh7Jk2" onClose={onClose} {...over} />);
  return { onClose };
}

describe("TempPasswordDialog", () => {
  it("hiện tên đăng nhập, mật khẩu tạm và cảnh báo chỉ hiện MỘT lần", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Mật khẩu tạm của nam" })).toBeInTheDocument();
    expect(screen.getByText("Ab3dEfGh7Jk2")).toBeInTheDocument();
    expect(screen.getByText(/Chỉ hiển thị MỘT lần/)).toBeInTheDocument();
  });

  it("Sao chép → ghi vào clipboard, toast KHÔNG chứa mật khẩu", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    setup();
    await user.click(screen.getByRole("button", { name: "Sao chép mật khẩu" }));
    expect(writeText).toHaveBeenCalledWith("Ab3dEfGh7Jk2");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Đã sao chép mật khẩu."));
    expect(JSON.stringify(toastSuccess.mock.calls)).not.toContain("Ab3dEfGh7Jk2");
  });

  it("clipboard không có/bị từ chối → toast lỗi hướng dẫn chép tay, không ném lỗi", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    setup();
    await user.click(screen.getByRole("button", { name: "Sao chép mật khẩu" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Không sao chép được. Hãy chọn mật khẩu và sao chép thủ công."));
    expect(toastSuccess).not.toHaveBeenCalled();

    toastError.mockReset();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    await user.click(screen.getByRole("button", { name: "Sao chép mật khẩu" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it("nút 'Đã ghi lại' đóng; click ra ngoài và Escape KHÔNG đóng khi còn mật khẩu (tránh mất vì bấm nhầm)", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 }); // thân trang bị Radix khoá pointer-events
    const { onClose } = setup();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    await user.click(document.querySelector("[data-state=open].fixed.inset-0")!); // lớp phủ
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Đã ghi lại" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("phản hồi lặp (password null) → không có mật khẩu/nút sao chép, chỉ dẫn 'Cấp lại mật khẩu'; Escape đóng được", async () => {
    const user = userEvent.setup();
    const { onClose } = setup({ password: null });
    expect(screen.getByText(/Cấp lại mật khẩu/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sao chép mật khẩu" })).toBeNull();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("đóng (open=false) → mật khẩu không còn trong DOM", () => {
    const { rerender } = render(<TempPasswordDialog open username="nam" password="Ab3dEfGh7Jk2" onClose={() => {}} />);
    expect(screen.getByText("Ab3dEfGh7Jk2")).toBeInTheDocument();
    rerender(<TempPasswordDialog open={false} username="nam" password="Ab3dEfGh7Jk2" onClose={() => {}} />);
    expect(document.body.textContent).not.toContain("Ab3dEfGh7Jk2");
  });
});
