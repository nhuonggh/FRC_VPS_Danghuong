// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsersTable } from "@/app/(app)/system/users/UsersTable";
import { ApiError, SessionExpiredError } from "@/lib/api-fetch";
import { parseListParams } from "@/lib/query-params";
import type { UserRow } from "@/server/users/queries";

const push = vi.fn();
const refresh = vi.fn();
const apiFetch = vi.fn();
const confirm = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/system/users" }));
vi.mock("@/lib/confirm-store", () => ({ confirm: (...a: unknown[]) => confirm(...a) }));
vi.mock("@/lib/toast", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const user = (over: Partial<UserRow> & { id: number }): UserRow => ({
  username: `u${over.id}`, fullName: `Người ${over.id}`, email: null, isLocked: false, mustChangePassword: false,
  createdAt: new Date("2026-09-01T03:00:00Z"), roles: [{ id: 1, name: "Kế toán" }], ...over,
});
const rows = [user({ id: 1, fullName: "Nguyễn Văn Nam" }), user({ id: 2, fullName: "Trần Thị Lan", isLocked: true }), user({ id: 3 })];
const params = parseListParams({}, ["status", "role"]);

beforeEach(() => {
  localStorage.clear();
  for (const m of [push, refresh, apiFetch, confirm, toastSuccess, toastError]) m.mockReset();
});
afterEach(cleanup);

function setup(over: Partial<React.ComponentProps<typeof UsersTable>> = {}) {
  render(<UsersTable rows={rows} canManage selfId={99} params={params} {...over} />);
}
const rowOf = (name: string) => screen.getAllByRole("row").find((r) => within(r).queryByText(name))!;

describe("UsersTable", () => {
  it("dòng là liên kết tới trang chi tiết; hiện nhóm quyền và trạng thái", () => {
    setup();
    expect(screen.getAllByRole("link", { name: "Nguyễn Văn Nam" })[0]).toHaveAttribute("href", "/system/users/1");
    expect(screen.getAllByText("Đã khóa").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Kế toán").length).toBeGreaterThan(0);
  });

  it("KHÔNG có user.manage: chỉ thao tác Xem; không có Sửa/Khóa/Cấp lại mật khẩu (ẩn hẳn, không disabled)", () => {
    setup({ canManage: false });
    expect(screen.getAllByRole("link", { name: "Xem" })).toHaveLength(rows.length * 2); // bảng + card mobile
    for (const name of ["Sửa", "Khóa", "Mở khóa", "Cấp lại mật khẩu", "Thêm thao tác"]) {
      expect(screen.queryAllByRole("button", { name })).toHaveLength(0);
      expect(screen.queryAllByRole("link", { name })).toHaveLength(0);
    }
  });

  it("có user.manage: Xem → Sửa → Khóa/Mở khóa theo trạng thái; 'Cấp lại mật khẩu' nằm trong menu ⋯", async () => {
    setup();
    const r1 = rowOf("Nguyễn Văn Nam");
    expect(within(r1).getByRole("link", { name: "Xem" })).toHaveAttribute("href", "/system/users/1");
    expect(within(r1).getByRole("link", { name: "Sửa" })).toHaveAttribute("href", "/system/users/1?edit=profile");
    expect(within(r1).getByRole("button", { name: "Khóa" })).toBeInTheDocument();
    expect(within(rowOf("Trần Thị Lan")).getByRole("button", { name: "Mở khóa" })).toBeInTheDocument();
    expect(within(r1).queryByRole("button", { name: "Cấp lại mật khẩu" })).toBeNull();
    await userEvent.click(within(r1).getByRole("button", { name: "Thêm thao tác" }));
    expect(await screen.findByRole("menuitem", { name: "Cấp lại mật khẩu" })).toBeInTheDocument();
  });

  it("không có nút Khóa cho chính mình (server cũng chặn)", () => {
    setup({ selfId: 1 });
    expect(within(rowOf("Nguyễn Văn Nam")).queryByRole("button", { name: "Khóa" })).toBeNull();
    expect(within(rowOf("Người 3")).getByRole("button", { name: "Khóa" })).toBeInTheDocument();
  });

  it("Khóa: hỏi xác nhận kiểu nguy hiểm → gọi API → toast + làm mới", async () => {
    confirm.mockResolvedValueOnce(true);
    apiFetch.mockResolvedValueOnce({ ok: true });
    setup();
    await userEvent.click(within(rowOf("Nguyễn Văn Nam")).getByRole("button", { name: "Khóa" }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Khóa tài khoản u1?", confirmLabel: "Khóa", danger: true }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/users/1/lock", { method: "POST", json: { locked: true } }));
    expect(toastSuccess).toHaveBeenCalledWith("Đã khóa tài khoản.");
    expect(refresh).toHaveBeenCalled();
  });

  it("Mở khóa: xác nhận không nguy hiểm; huỷ xác nhận → không gọi API", async () => {
    confirm.mockResolvedValueOnce(false);
    setup();
    await userEvent.click(within(rowOf("Trần Thị Lan")).getByRole("button", { name: "Mở khóa" }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Mở khóa tài khoản u2?", danger: false }));
    expect(apiFetch).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("lỗi 'còn quản trị viên' từ server hiện thành toast lỗi, không làm mới", async () => {
    confirm.mockResolvedValueOnce(true);
    apiFetch.mockRejectedValueOnce(new ApiError(409, "Hệ thống phải còn ít nhất một tài khoản đang hoạt động có quyền quản lý người dùng."));
    setup();
    await userEvent.click(within(rowOf("Người 3")).getByRole("button", { name: "Khóa" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringContaining("còn ít nhất một tài khoản")));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("phiên hết hạn (401): apiFetch đã hiện toast bền → không thêm toast lỗi thứ hai", async () => {
    confirm.mockResolvedValueOnce(true);
    apiFetch.mockRejectedValueOnce(new SessionExpiredError());
    setup();
    await userEvent.click(within(rowOf("Người 3")).getByRole("button", { name: "Khóa" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled(); // không redirect
  });

  it("Cấp lại mật khẩu: xác nhận → mật khẩu tạm hiện đúng 1 lần trong hộp thoại; đóng thì biến mất", async () => {
    confirm.mockResolvedValueOnce(true);
    apiFetch.mockResolvedValueOnce({ tempPassword: "Zx9Kp2Lm4Qrs" });
    setup();
    await userEvent.click(within(rowOf("Người 3")).getByRole("button", { name: "Thêm thao tác" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Cấp lại mật khẩu" }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Cấp lại mật khẩu cho u3?", danger: true }));
    expect(await screen.findByText("Zx9Kp2Lm4Qrs")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/api/users/3/reset-password", { method: "POST" });
    expect(refresh).not.toHaveBeenCalled(); // chưa làm mới khi còn hiện mật khẩu
    await userEvent.click(screen.getByRole("button", { name: "Đã ghi lại" }));
    await waitFor(() => expect(screen.queryByText("Zx9Kp2Lm4Qrs")).toBeNull());
    expect(document.body.textContent).not.toContain("Zx9Kp2Lm4Qrs");
    expect(refresh).toHaveBeenCalledTimes(1); // đóng hộp thoại → làm mới (huy hiệu "Chờ đổi mật khẩu", nhật ký)
  });

  it("tài khoản của chính mình: KHÔNG có 'Cấp lại mật khẩu', có lối tới /change-password; người khác vẫn có", async () => {
    setup({ selfId: 1 });
    const mine = rowOf("Nguyễn Văn Nam");
    expect(within(mine).getByRole("link", { name: "Đổi mật khẩu của tôi" })).toHaveAttribute("href", "/change-password");
    expect(within(mine).queryByRole("button", { name: "Cấp lại mật khẩu" })).toBeNull();
    expect(within(mine).queryByRole("button", { name: "Thêm thao tác" })).toBeNull(); // 3 thao tác đều hiện sẵn, không có menu ⋯
    const other = rowOf("Người 3");
    await userEvent.click(within(other).getByRole("button", { name: "Thêm thao tác" }));
    expect(await screen.findByRole("menuitem", { name: "Cấp lại mật khẩu" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Đổi mật khẩu của tôi" })).toBeNull();
  });
});
