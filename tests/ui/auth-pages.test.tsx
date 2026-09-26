import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChangePasswordPage from "@/app/change-password/page";
import { ChangePasswordForm } from "@/app/change-password/ChangePasswordForm";
import { SignOutButton } from "@/app/change-password/SignOutButton";
import LoginPage from "@/app/(auth)/login/page";
import { LoginForm } from "@/app/(auth)/login/LoginForm";

const getActor = vi.fn();
const requireActor = vi.fn();
const redirect = vi.fn((to: string): never => { throw new Error(`REDIRECT:${to}`); });
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));
vi.mock("@/server/auth/session", () => ({ getActor: () => getActor(), requireActor: () => requireActor() }));
// Trang chỉ dựng cây phần tử; không render → không cần next-auth/react
vi.mock("@/app/(auth)/login/LoginForm", () => ({ LoginForm: () => null }));
vi.mock("@/app/change-password/ChangePasswordForm", () => ({ ChangePasswordForm: () => null }));
vi.mock("@/app/change-password/SignOutButton", () => ({ SignOutButton: () => null }));

beforeEach(() => { getActor.mockReset(); requireActor.mockReset(); redirect.mockClear(); });

/** Duyệt cây phần tử React (không render) tìm phần tử theo type. */
function find(node: ReactNode, type: unknown): ReactElement | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const n of node) { const r = find(n, type); if (r) return r; } return null; }
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el.type === type) return el;
  return find(el.props?.children, type);
}
const text = (node: ReactNode): string =>
  !node ? "" : typeof node === "string" ? node : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text((node as ReactElement<{ children?: ReactNode }>).props?.children) : "";

describe("/login (server)", () => {
  it("đã đăng nhập → redirect về '/'", async () => {
    getActor.mockResolvedValue({ userId: 1 });
    await expect(LoginPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/");
  });

  it("chưa đăng nhập → hiện form, chuyển callbackUrl xuống form", async () => {
    getActor.mockResolvedValue(null);
    const tree = await LoginPage({ searchParams: Promise.resolve({ callbackUrl: "/sales/orders" }) });
    expect(find(tree, LoginForm)?.props).toMatchObject({ callbackUrl: "/sales/orders" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("callbackUrl lặp (mảng) → lấy giá trị đầu", async () => {
    getActor.mockResolvedValue(null);
    const tree = await LoginPage({ searchParams: Promise.resolve({ callbackUrl: ["/a", "/b"] }) });
    expect(find(tree, LoginForm)?.props).toMatchObject({ callbackUrl: "/a" });
  });
});

describe("/login (server) — Google", () => {
  const saved = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
  const setEnv = (id?: string, secret?: string) => {
    if (id === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = id;
    if (secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = secret;
  };
  afterEach(() => setEnv(saved.id, saved.secret));

  it("không có biến Google → googleEnabled=false", async () => {
    setEnv(undefined, undefined);
    getActor.mockResolvedValue(null);
    expect(find(await LoginPage({ searchParams: Promise.resolve({}) }), LoginForm)?.props).toMatchObject({ googleEnabled: false });
  });

  it("đủ biến → googleEnabled=true; props xuống client KHÔNG chứa client id/secret", async () => {
    setEnv("fake-client-id.apps.googleusercontent.test", "fake-client-secret-XYZ");
    getActor.mockResolvedValue(null);
    const props = find(await LoginPage({ searchParams: Promise.resolve({}) }), LoginForm)?.props;
    expect(props).toMatchObject({ googleEnabled: true });
    expect(JSON.stringify(props)).not.toMatch(/fake-client-id|fake-client-secret/);
  });

  it("?error= (lặp → lấy giá trị đầu) chuyển xuống form", async () => {
    getActor.mockResolvedValue(null);
    const tree = await LoginPage({ searchParams: Promise.resolve({ error: ["GoogleNotAllowed", "x"], callbackUrl: "/a" }) });
    expect(find(tree, LoginForm)?.props).toMatchObject({ error: "GoogleNotAllowed", callbackUrl: "/a" });
  });
});

describe("/change-password (server)", () => {
  it("chưa đăng nhập → requireActor chuyển hướng (không hiện form)", async () => {
    requireActor.mockRejectedValue(new Error("REDIRECT:/login"));
    await expect(ChangePasswordPage()).rejects.toThrow("REDIRECT:/login");
  });

  it("bị bắt đổi mật khẩu → có lời nhắc và form ở chế độ forced", async () => {
    requireActor.mockResolvedValue({ mustChangePassword: true });
    const tree = await ChangePasswordPage();
    expect(text(tree)).toContain("Bạn cần đổi mật khẩu trước khi sử dụng hệ thống.");
    expect(find(tree, ChangePasswordForm)?.props).toMatchObject({ forced: true });
  });

  it("trang nằm ngoài khung ứng dụng nên có nút Đăng xuất riêng", async () => {
    requireActor.mockResolvedValue({ mustChangePassword: true });
    expect(find(await ChangePasswordPage(), SignOutButton)).not.toBeNull();
  });

  it("tự nguyện đổi → không có lời nhắc, forced=false", async () => {
    requireActor.mockResolvedValue({ mustChangePassword: false });
    const tree = await ChangePasswordPage();
    expect(text(tree)).not.toContain("Bạn cần đổi mật khẩu");
    expect(find(tree, ChangePasswordForm)?.props).toMatchObject({ forced: false });
  });
});
