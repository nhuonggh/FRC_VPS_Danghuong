// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/app/(auth)/login/LoginForm";

const signIn = vi.fn();
vi.mock("next-auth/react", () => ({ signIn: (...a: unknown[]) => signIn(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

// Promise chờ điều khiển được: 'chuyển sang Google' không bao giờ xong trong jsdom — giải phóng sau mỗi test
let release: (() => void) | null = null;
const pendingRedirect = () => new Promise<void>((r) => { release = () => r(); });
beforeEach(() => signIn.mockReset());
afterEach(() => { release?.(); release = null; cleanup(); });

const GOOGLE = "Đăng nhập bằng Google";

describe("LoginForm — nút Google", () => {
  it("chưa cấu hình Google → KHÔNG có nút, KHÔNG có vạch 'hoặc' (y như trước)", () => {
    render(<LoginForm />);
    expect(screen.queryByRole("button", { name: GOOGLE })).toBeNull();
    expect(screen.queryByText("hoặc")).toBeNull();
    render(<LoginForm googleEnabled={false} />);
    expect(screen.queryByRole("button", { name: GOOGLE })).toBeNull();
  });

  it("đã cấu hình → nút phụ (outline) cao 44px dưới form + vạch 'hoặc'", () => {
    render(<LoginForm googleEnabled />);
    const btn = screen.getByRole("button", { name: GOOGLE });
    expect(btn).toHaveAttribute("type", "button");
    expect(btn).toHaveClass("h-12", "border", "border-border", "bg-surface"); // cao 48px (≥ 44px)
    expect(screen.getByText("hoặc")).toBeInTheDocument();
    // nằm SAU nút Đăng nhập chính
    const primary = screen.getByRole("button", { name: "Đăng nhập" });
    expect(primary.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("bấm → signIn('google') với callbackUrl nội bộ; nút khoá + spinner khi chờ; chặn bấm đúp", async () => {
    signIn.mockReturnValue(pendingRedirect()); // trình duyệt đang chuyển sang Google
    render(<LoginForm googleEnabled callbackUrl="/system/users?tab=roles" />);
    await userEvent.click(screen.getByRole("button", { name: GOOGLE }));
    expect(signIn).toHaveBeenCalledWith("google", { callbackUrl: "/system/users?tab=roles" });
    const pending = screen.getByRole("button", { name: "Đang chuyển tới Google" });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(pending.querySelector("svg.animate-spin")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Đăng nhập" })).toBeDisabled(); // không đăng nhập song song 2 cách
    await userEvent.click(pending);
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it.each(["https://evil.example/x", "//evil.example", "/\\evil.example", "/login?x=1", "javascript:alert(1)"])(
    "callbackUrl ngoài/độc hại %j → gửi '/' cho Google",
    async (cb) => {
      signIn.mockReturnValue(pendingRedirect());
      render(<LoginForm googleEnabled callbackUrl={cb} />);
      await userEvent.click(screen.getByRole("button", { name: GOOGLE }));
      expect(signIn).toHaveBeenCalledWith("google", { callbackUrl: "/" });
    },
  );

  it("lỗi mạng khi bắt đầu → mở lại nút + thông báo tiếng Việt", async () => {
    signIn.mockRejectedValueOnce(new Error("network"));
    render(<LoginForm googleEnabled />);
    await userEvent.click(screen.getByRole("button", { name: GOOGLE }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không kết nối được máy chủ");
    await waitFor(() => expect(screen.getByRole("button", { name: GOOGLE })).toBeEnabled());
  });
});

describe("LoginForm — lỗi ?error= trên URL", () => {
  it("GoogleNotAllowed → alert tiếng Việt yêu cầu", () => {
    render(<LoginForm googleEnabled error="GoogleNotAllowed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Tài khoản Google này chưa được cấp quyền vào hệ thống. Liên hệ quản trị viên.");
  });

  it.each([
    ["OAuthCallback", "Đăng nhập bằng Google không thành công. Vui lòng thử lại."],
    ["AccessDenied", "Tài khoản Google này chưa được cấp quyền vào hệ thống. Liên hệ quản trị viên."],
    ["Configuration", "Hệ thống đăng nhập đang gặp sự cố cấu hình. Liên hệ quản trị viên."],
    ["<img src=x onerror=alert(1)>", "Không đăng nhập được, vui lòng thử lại."],
  ])("%s → thông báo tiếng Việt, không lộ mã", (code, msg) => {
    render(<LoginForm error={code} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(msg);
    expect(alert.textContent).not.toContain(code);
    expect(alert.querySelector("img")).toBeNull();
  });

  it("không có error → không có alert", () => {
    render(<LoginForm googleEnabled />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("gửi form mật khẩu → xoá thông báo lỗi Google cũ", async () => {
    signIn.mockResolvedValueOnce({ ok: false, error: "CredentialsSignin" });
    render(<LoginForm googleEnabled error="GoogleNotAllowed" />);
    await userEvent.type(screen.getByLabelText("Tên đăng nhập"), "nam");
    await userEvent.type(screen.getByLabelText("Mật khẩu"), "Sai12345");
    await userEvent.click(screen.getByRole("button", { name: "Đăng nhập" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tên đăng nhập hoặc mật khẩu không đúng.");
  });
});
