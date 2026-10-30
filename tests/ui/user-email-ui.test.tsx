// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserDetail } from "@/app/(app)/system/users/[id]/UserDetail";
import { NewUserForm } from "@/app/(app)/system/users/new/NewUserForm";
import { UsersTable } from "@/app/(app)/system/users/UsersTable";
import { ApiError } from "@/lib/api-fetch";
import { parseListParams } from "@/lib/query-params";
import { useToastStore } from "@/lib/toast";
import type { UserRow } from "@/server/users/queries";

const nav = vi.hoisted(() => ({ search: "", refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: nav.refresh, push: nav.push, replace: nav.replace }),
  usePathname: () => "/system/users/5",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const apiFetch = vi.fn();
vi.mock("@/lib/confirm-store", () => ({ confirm: vi.fn() }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

beforeEach(() => {
  nav.search = "";
  for (const m of [nav.refresh, nav.push, nav.replace, apiFetch]) m.mockReset();
  useToastStore.setState({ items: [] });
  localStorage.clear();
});
afterEach(cleanup);

const detailBase: React.ComponentProps<typeof UserDetail> = {
  user: { id: 5, username: "lan.tran", fullName: "Trần Thị Lan", email: null, isLocked: false, canAdvance: false, mustChangePassword: false, createdAt: "2026-09-01T03:00:00.000Z", roles: [{ id: 2, name: "Kế toán" }] },
  roles: [{ id: 2, name: "Kế toán" }],
  history: [{ id: 1, action: "user.set_email", at: "2026-09-02T04:00:00.000Z", by: "Admin" }],
  canManage: true,
  isSelf: false,
};

describe("UserDetail — phần Đăng nhập Google", () => {
  it("email NULL → '—'; có email → hiện; lịch sử có nhãn tiếng Việt", async () => {
    const { unmount } = render(<UserDetail {...detailBase} />);
    const section = screen.getByRole("heading", { name: "Đăng nhập Google" }).closest("section")!;
    expect(within(section).getByText("—")).toBeInTheDocument();
    unmount();
    render(<UserDetail {...detailBase} user={{ ...detailBase.user, email: "lan@example.test" }} />);
    expect(screen.getByText("lan@example.test", { selector: "dd" })).toBeInTheDocument();
    cleanup();
    nav.search = "tab=history";
    render(<UserDetail {...detailBase} />);
    expect(screen.getByText(/Đổi email đăng nhập Google/)).toBeInTheDocument();
  });

  it("chỉ xem (không user.manage) → không có bút chì sửa email, ?edit=email không mở ô", () => {
    nav.search = "edit=email";
    render(<UserDetail {...detailBase} canManage={false} />);
    expect(screen.queryByRole("button", { name: "Chỉnh sửa email đăng nhập Google" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("sửa: PATCH {section:'email', email} đã chuẩn hoá", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true });
    render(<UserDetail {...detailBase} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa email đăng nhập Google" }));
    const input = screen.getByLabelText("Email");
    await userEvent.type(input, "  Lan@Example.TEST ");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/users/5/section-update", { method: "PATCH", json: { section: "email", email: "lan@example.test" } }));
  });

  it("sai định dạng → lỗi tiếng Việt tại ô, không gọi API", async () => {
    render(<UserDetail {...detailBase} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa email đăng nhập Google" }));
    await userEvent.type(screen.getByLabelText("Email"), "abc");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByText("Email không hợp lệ.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("trùng (409) → thông báo thân thiện, vẫn ở chế độ sửa", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, "Email đã được dùng cho tài khoản khác.", "CONFLICT", { email: "Email đã được dùng cho tài khoản khác." }));
    render(<UserDetail {...detailBase} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa email đăng nhập Google" }));
    await userEvent.type(screen.getByLabelText("Email"), "dup@example.test");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByText("Email đã được dùng cho tài khoản khác.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });
});

describe("NewUserForm — email", () => {
  const roles = [{ id: 2, name: "Kế toán", description: null }];
  async function fill(email: string) {
    await userEvent.type(screen.getByLabelText("Tên đăng nhập"), "lan.tran");
    await userEvent.type(screen.getByLabelText("Họ tên"), "Trần Thị Lan");
    if (email) await userEvent.type(screen.getByLabelText(/Email đăng nhập Google/), email);
    await userEvent.click(screen.getByRole("checkbox", { name: /Kế toán/ }));
    await userEvent.click(screen.getByRole("button", { name: "Tạo người dùng" }));
  }

  it("email tuỳ chọn, gửi dạng chuẩn hoá", async () => {
    apiFetch.mockResolvedValueOnce({ id: 3, tempPassword: "Aa1bB2cC3dD4" });
    render(<NewUserForm roles={roles} />);
    await fill(" Lan@Example.TEST ");
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(apiFetch.mock.calls[0]![1].json).toMatchObject({ email: "lan@example.test" });
  });

  it("sai định dạng → lỗi tại ô, không gọi API", async () => {
    render(<NewUserForm roles={roles} />);
    await fill("abc");
    expect(await screen.findByText("Email không hợp lệ.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("409 trùng email (fields.email) → lỗi dưới ô Email, KHÔNG gán nhầm vào tên đăng nhập", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, "Email đã được dùng cho tài khoản khác.", "CONFLICT", { email: "Email đã được dùng cho tài khoản khác." }));
    render(<NewUserForm roles={roles} />);
    await fill("dup@example.test");
    const input = await screen.findByLabelText(/Email đăng nhập Google/);
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(input).toHaveAccessibleDescription(/Email đã được dùng cho tài khoản khác\./);
    expect(screen.getByLabelText("Tên đăng nhập")).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("UsersTable — cột Email", () => {
  const row = (over: Partial<UserRow> & { id: number }): UserRow => ({
    username: `u${over.id}`, fullName: `Người ${over.id}`, email: null, isLocked: false, canAdvance: false, mustChangePassword: false,
    createdAt: new Date("2026-09-01T03:00:00Z"), roles: [], ...over,
  });

  it("có cột Email; NULL → '—'", () => {
    render(<UsersTable rows={[row({ id: 1, email: "a@example.test" }), row({ id: 2 })]} canManage selfId={99} params={parseListParams({}, ["status", "role"])} />);
    expect(screen.getAllByRole("columnheader", { name: /Email/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByText("a@example.test").length).toBeGreaterThan(0);
    const r2 = screen.getAllByRole("row").find((r) => within(r).queryByText("Người 2"))!;
    expect(within(r2).getByText("—")).toBeInTheDocument();
  });
});
