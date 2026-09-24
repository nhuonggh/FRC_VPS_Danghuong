// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangePasswordForm } from "@/app/change-password/ChangePasswordForm";
import { ApiError } from "@/lib/api-fetch";

const replace = vi.fn();
const refresh = vi.fn();
const apiFetch = vi.fn();
const toastSuccess = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));
vi.mock("@/lib/api-fetch", async (orig) => ({
  ...(await orig<typeof import("@/lib/api-fetch")>()),
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

beforeEach(() => { apiFetch.mockReset(); replace.mockReset(); refresh.mockReset(); toastSuccess.mockReset(); });
afterEach(cleanup);

async function fill(current: string, next: string, confirm: string, currentLabel = "Mật khẩu hiện tại") {
  if (current) await userEvent.type(screen.getByLabelText(currentLabel), current);
  if (next) await userEvent.type(screen.getByLabelText("Mật khẩu mới"), next);
  if (confirm) await userEvent.type(screen.getByLabelText("Nhập lại mật khẩu mới"), confirm);
  await userEvent.click(screen.getByRole("button", { name: "Đổi mật khẩu" }));
}

describe("ChangePasswordForm", () => {
  it("thành công → gọi API với current/next (không gửi confirm), toast, về trang chủ và làm mới", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true });
    render(<ChangePasswordForm forced={false} />);
    await fill("Cu12345678", "Moi12345678", "Moi12345678");
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(apiFetch).toHaveBeenCalledWith("/api/account/change-password", { method: "POST", json: { current: "Cu12345678", next: "Moi12345678" } });
    expect(toastSuccess).toHaveBeenCalledWith("Đã đổi mật khẩu.");
    expect(refresh).toHaveBeenCalled();
  });

  it("bắt buộc nhập mật khẩu hiện tại/tạm — không gọi API khi thiếu", async () => {
    render(<ChangePasswordForm forced={false} />);
    await fill("", "Moi12345678", "Moi12345678");
    expect(await screen.findByText("Nhập mật khẩu hiện tại.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("nhập lại không khớp → lỗi ở ô xác nhận, không gọi API", async () => {
    render(<ChangePasswordForm forced={false} />);
    await fill("Cu12345678", "Moi12345678", "Khac12345678");
    expect(await screen.findByText("Mật khẩu nhập lại không khớp.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("mật khẩu mới trùng mật khẩu hiện tại → báo ngay, không gọi API", async () => {
    render(<ChangePasswordForm forced={false} />);
    await fill("Cung12345678", "Cung12345678", "Cung12345678");
    expect(await screen.findByText("Mật khẩu mới phải khác mật khẩu hiện tại.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it.each([
    "Mật khẩu tối thiểu 8 ký tự.",
    "Mật khẩu phải có cả chữ và số.",
    "Mật khẩu tối đa 72 byte (ký tự có dấu chiếm nhiều byte hơn).",
    "Mật khẩu hiện tại không đúng.",
  ])("lỗi từ máy chủ %j hiện trong khung cảnh báo, giữ dữ liệu, không chuyển trang", async (msg) => {
    apiFetch.mockRejectedValueOnce(new ApiError(400, msg));
    render(<ChangePasswordForm forced={false} />);
    await fill("Cu12345678", "Moi12345678", "Moi12345678");
    expect(await screen.findByRole("alert")).toHaveTextContent(msg);
    expect(screen.getByLabelText("Mật khẩu mới")).toHaveValue("Moi12345678");
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Đổi mật khẩu" })).toBeEnabled();
  });

  it("mất mạng / lỗi lạ → thông báo tiếng Việt thay vì im lặng", async () => {
    apiFetch.mockRejectedValueOnce(new Error("boom"));
    render(<ChangePasswordForm forced={false} />);
    await fill("Cu12345678", "Moi12345678", "Moi12345678");
    expect(await screen.findByRole("alert")).toHaveTextContent("Không đổi được mật khẩu, vui lòng thử lại.");
  });

  it("bị bắt đổi (forced): nhãn ô đầu là mật khẩu tạm được cấp", () => {
    render(<ChangePasswordForm forced />);
    expect(screen.getByLabelText("Mật khẩu tạm (được cấp)")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("Mật khẩu mới")).toHaveAttribute("autocomplete", "new-password");
  });

  it("đang gửi: nút bị khoá, chỉ gọi API một lần", async () => {
    let done!: (v: unknown) => void;
    apiFetch.mockReturnValueOnce(new Promise((r) => { done = r; }));
    render(<ChangePasswordForm forced={false} />);
    await fill("Cu12345678", "Moi12345678", "Moi12345678");
    expect(await screen.findByRole("button", { name: "Đang lưu" })).toBeDisabled();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    done({ ok: true });
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });
});
