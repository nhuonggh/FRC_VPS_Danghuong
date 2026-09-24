// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/app/(auth)/login/LoginForm";

const signIn = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next-auth/react", () => ({ signIn: (...a: unknown[]) => signIn(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

beforeEach(() => { signIn.mockReset(); replace.mockReset(); refresh.mockReset(); });
afterEach(cleanup);

async function submit(u = "nam", p = "Xuong2026") {
  await userEvent.type(screen.getByLabelText("Tên đăng nhập"), u);
  await userEvent.type(screen.getByLabelText("Mật khẩu"), p);
  await userEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
}

describe("LoginForm", () => {
  it("thành công → chuyển tới callbackUrl an toàn", async () => {
    signIn.mockResolvedValueOnce({ ok: true, error: null });
    render(<LoginForm callbackUrl="/sales/orders" />);
    await submit();
    expect(signIn).toHaveBeenCalledWith("credentials", { username: "nam", password: "Xuong2026", redirect: false });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sales/orders"));
    expect(refresh).toHaveBeenCalled();
  });

  it("callbackUrl độc hại (open redirect) → về trang chủ", async () => {
    signIn.mockResolvedValueOnce({ ok: true, error: null });
    render(<LoginForm callbackUrl="//evil.com/x" />);
    await submit();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("không có callbackUrl → về trang chủ", async () => {
    signIn.mockResolvedValueOnce({ ok: true, error: null });
    render(<LoginForm />);
    await submit();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("sai mật khẩu → thông báo trung lập, KHÔNG nói rõ sai cái nào", async () => {
    signIn.mockResolvedValueOnce({ ok: false, error: "CredentialsSignin" });
    render(<LoginForm />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Tên đăng nhập hoặc mật khẩu không đúng.");
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("tài khoản bị khoá → thông báo riêng", async () => {
    signIn.mockResolvedValueOnce({ ok: false, error: "LOCKED" });
    render(<LoginForm />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Tài khoản đã bị khóa. Liên hệ giám đốc để mở khóa.");
  });

  it("lỗi lạ / mất mạng → thông báo tiếng Việt, nút mở lại để thử lại", async () => {
    signIn.mockRejectedValueOnce(new Error("network"));
    render(<LoginForm />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Không kết nối được máy chủ");
    expect(screen.getByRole("button", { name: "Đăng nhập" })).toBeEnabled();
  });

  it("nút bị vô hiệu trong lúc chờ (chặn bấm đúp)", async () => {
    let done!: (v: unknown) => void;
    signIn.mockReturnValueOnce(new Promise((r) => { done = r; }));
    render(<LoginForm />);
    await submit();
    expect(screen.getByRole("button", { name: "Đang đăng nhập" })).toBeDisabled();
    expect(signIn).toHaveBeenCalledTimes(1);
    done({ ok: true, error: null });
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  it("bắt buộc nhập đủ 2 ô; nút hiện/ẩn mật khẩu", async () => {
    render(<LoginForm />);
    await userEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
    expect(signIn).not.toHaveBeenCalled();
    expect(screen.getByText("Nhập tên đăng nhập.")).toBeInTheDocument();
    expect(screen.getByLabelText("Tên đăng nhập")).toHaveAttribute("aria-invalid", "true");
    const pw = screen.getByLabelText("Mật khẩu");
    expect(pw).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: "Hiện mật khẩu" }));
    expect(pw).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Ẩn mật khẩu" })).toBeInTheDocument();
  });

  it("Enter trong ô mật khẩu gửi form; tên đăng nhập được cắt khoảng trắng", async () => {
    signIn.mockResolvedValueOnce({ ok: true, error: null });
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText("Tên đăng nhập"), "  nam  ");
    await userEvent.type(screen.getByLabelText("Mật khẩu"), "Xuong2026{Enter}");
    expect(signIn).toHaveBeenCalledWith("credentials", { username: "nam", password: "Xuong2026", redirect: false });
    await waitFor(() => expect(replace).toHaveBeenCalled());
  });

  it("ô nhập có autoComplete đúng để trình quản lý mật khẩu hoạt động", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Tên đăng nhập")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Mật khẩu")).toHaveAttribute("autocomplete", "current-password");
  });
});
