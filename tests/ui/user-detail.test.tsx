// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserDetail } from "@/app/(app)/system/users/[id]/UserDetail";
import { ApiError, SessionExpiredError } from "@/lib/api-fetch";
import { useToastStore } from "@/lib/toast";

const nav = vi.hoisted(() => ({ search: "", refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: nav.refresh, push: nav.push, replace: nav.replace }),
  usePathname: () => "/system/users/5",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const confirm = vi.fn();
const apiFetch = vi.fn();
vi.mock("@/lib/confirm-store", () => ({ confirm: (...a: unknown[]) => confirm(...a) }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const base: React.ComponentProps<typeof UserDetail> = {
  user: { id: 5, username: "lan.tran", fullName: "Trần Thị Lan", email: null, isLocked: false, canAdvance: false, mustChangePassword: false, createdAt: "2026-09-01T03:00:00.000Z", roles: [{ id: 2, name: "Kế toán" }] },
  roles: [{ id: 1, name: "Giám đốc" }, { id: 2, name: "Kế toán" }],
  history: [{ id: 9, action: "user.reset_password", at: "2026-09-02T04:00:00.000Z", by: "Nguyễn Văn Nam" }],
  canManage: true,
  isSelf: false,
};
const toasts = () => useToastStore.getState().items;

beforeEach(() => {
  nav.search = "";
  for (const m of [nav.refresh, nav.push, nav.replace, confirm, apiFetch]) m.mockReset();
  useToastStore.setState({ items: [] });
});
afterEach(cleanup);

describe("UserDetail — quyền xem/sửa", () => {
  it("chỉ có user.view: chữ tĩnh, KHÔNG bút chì, KHÔNG nút Khóa/Cấp lại mật khẩu", () => {
    render(<UserDetail {...base} canManage={false} />);
    expect(screen.getByRole("heading", { level: 1, name: "Trần Thị Lan" })).toBeInTheDocument();
    expect(screen.getByText("lan.tran", { selector: "dd" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Chỉnh sửa/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Khóa/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Cấp lại mật khẩu/ })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("chỉ xem mà URL có ?edit=profile → vẫn KHÔNG mở ô nhập (tránh form sửa không có nút Lưu)", () => {
    nav.search = "edit=profile";
    render(<UserDetail {...base} canManage={false} />);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("có user.manage: bút chì + nút Khóa + Cấp lại mật khẩu; xem chính mình → không có nút Khóa", () => {
    const { unmount } = render(<UserDetail {...base} />);
    expect(screen.getByRole("button", { name: "Chỉnh sửa thông tin cơ bản" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Khóa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cấp lại mật khẩu" })).toBeInTheDocument();
    unmount();
    render(<UserDetail {...base} isSelf />);
    expect(screen.queryByRole("button", { name: "Khóa" })).toBeNull();
  });

  it("tài khoản đang khóa: nút 'Mở khóa' + huy hiệu 'Đã khóa'; chờ đổi mật khẩu có huy hiệu riêng", () => {
    render(<UserDetail {...base} user={{ ...base.user, isLocked: true, mustChangePassword: true }} />);
    expect(screen.getByRole("button", { name: "Mở khóa" })).toBeInTheDocument();
    expect(screen.getByText("Đã khóa")).toBeInTheDocument();
    expect(screen.getByText("Chờ đổi mật khẩu")).toBeInTheDocument();
  });
});

describe("UserDetail — sửa từng phần", () => {
  it("sửa họ tên: PATCH section-update {section:'profile'} → toast + làm mới", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true });
    render(<UserDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa thông tin cơ bản" }));
    const input = screen.getByLabelText("Họ tên");
    expect(input).toHaveValue("Trần Thị Lan");
    await userEvent.clear(input);
    await userEvent.type(input, "Trần Lan Anh");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/users/5/section-update", { method: "PATCH", json: { section: "profile", fullName: "Trần Lan Anh" } }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(toasts().map((t) => t.message)).toContain("Đã lưu thay đổi.");
  });

  it("họ tên rỗng → lỗi dưới ô, không gọi API", async () => {
    render(<UserDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa thông tin cơ bản" }));
    await userEvent.clear(screen.getByLabelText("Họ tên"));
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByText("Nhập họ tên.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
    const input = screen.getByLabelText("Họ tên");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Nhập họ tên."); // aria-describedby trỏ tới thông báo lỗi
    expect(input).toHaveClass("h-11", "md:h-9");
  });

  it("đổi nhóm quyền: gửi roleIds; lỗi 'còn quản trị viên' hiện ở khung cảnh báo, vẫn ở chế độ sửa", async () => {
    nav.search = "tab=roles";
    apiFetch.mockRejectedValueOnce(new ApiError(409, "Hệ thống phải còn ít nhất một tài khoản đang hoạt động có quyền quản lý người dùng."));
    render(<UserDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa nhóm quyền" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Giám đốc" }));
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/users/5/section-update", { method: "PATCH", json: { section: "roles", roleIds: [2, 1] } }));
    expect(await screen.findByRole("alert")).toHaveTextContent("còn ít nhất một tài khoản");
    expect(screen.getByRole("button", { name: "Lưu" })).toBeEnabled();
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("bỏ hết nhóm quyền → 'Chọn ít nhất 1 nhóm quyền.', không gọi API", async () => {
    nav.search = "tab=roles";
    render(<UserDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa nhóm quyền" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Kế toán" }));
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByText("Chọn ít nhất 1 nhóm quyền.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("chỉ xem: tab Nhóm quyền hiện tên nhóm dạng chữ, không có ô chọn", () => {
    nav.search = "tab=roles";
    render(<UserDetail {...base} canManage={false} />);
    expect(screen.getByText("Kế toán", { selector: "dd" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("UserDetail — khóa / cấp lại mật khẩu", () => {
  it("Khóa: hộp xác nhận kiểu nguy hiểm → POST lock → toast + làm mới", async () => {
    confirm.mockResolvedValueOnce(true);
    apiFetch.mockResolvedValueOnce({ ok: true });
    render(<UserDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Khóa" }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Khóa tài khoản lan.tran?", confirmLabel: "Khóa", danger: true }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/users/5/lock", { method: "POST", json: { locked: true } }));
    expect(toasts().map((t) => t.message)).toContain("Đã khóa tài khoản.");
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("Mở khóa: xác nhận KHÔNG nguy hiểm; hủy xác nhận → không gọi API", async () => {
    confirm.mockResolvedValueOnce(false);
    render(<UserDetail {...base} user={{ ...base.user, isLocked: true }} />);
    await userEvent.click(screen.getByRole("button", { name: "Mở khóa" }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: false, confirmLabel: "Mở khóa" }));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("khóa người quản trị cuối → lỗi server hiện thành toast lỗi", async () => {
    confirm.mockResolvedValueOnce(true);
    apiFetch.mockRejectedValueOnce(new ApiError(409, "Hệ thống phải còn ít nhất một tài khoản đang hoạt động có quyền quản lý người dùng."));
    render(<UserDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Khóa" }));
    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ kind: "error", message: expect.stringContaining("còn ít nhất một tài khoản") })]));
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("phiên hết hạn khi khóa → không toast trùng (apiFetch lo), không redirect", async () => {
    confirm.mockResolvedValueOnce(true);
    apiFetch.mockRejectedValueOnce(new SessionExpiredError());
    render(<UserDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Khóa" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(toasts()).toEqual([]);
    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("Cấp lại mật khẩu: xác nhận nguy hiểm → mật khẩu tạm hiện 1 lần; đóng thì xoá khỏi DOM", async () => {
    confirm.mockResolvedValueOnce(true);
    apiFetch.mockResolvedValueOnce({ tempPassword: "Zx9Kp2Lm4Qrs" });
    render(<UserDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Cấp lại mật khẩu" }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Cấp lại mật khẩu cho lan.tran?", danger: true }));
    expect(await screen.findByText("Zx9Kp2Lm4Qrs")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/api/users/5/reset-password", { method: "POST" });
    expect(nav.refresh).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Đã ghi lại" }));
    await waitFor(() => expect(document.body.textContent).not.toContain("Zx9Kp2Lm4Qrs"));
    expect(nav.refresh).toHaveBeenCalledTimes(1); // huy hiệu "Chờ đổi mật khẩu" + tab Nhật ký cập nhật
  });

  it("xem chính mình: KHÔNG có 'Cấp lại mật khẩu' (thay bằng liên kết tới /change-password)", () => {
    render(<UserDetail {...base} isSelf />);
    expect(screen.queryByRole("button", { name: "Cấp lại mật khẩu" })).toBeNull();
    expect(screen.getByRole("link", { name: "Đổi mật khẩu của tôi" })).toHaveAttribute("href", "/change-password");
  });

  it("nút hành động ở đầu trang chạm ≥44px trên mobile", () => {
    render(<UserDetail {...base} />);
    for (const name of ["Khóa", "Cấp lại mật khẩu"]) expect(screen.getByRole("button", { name })).toHaveClass("h-11", "md:h-10");
  });

  it("Cấp lại mật khẩu bị 403 (vượt quyền) → toast lỗi, không hộp thoại mật khẩu", async () => {
    confirm.mockResolvedValueOnce(true);
    apiFetch.mockRejectedValueOnce(new ApiError(403, "Bạn không có quyền tác động lên tài khoản này."));
    render(<UserDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Cấp lại mật khẩu" }));
    await waitFor(() => expect(toasts()).toHaveLength(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("UserDetail — nhật ký", () => {
  it("hiện thao tác bằng tiếng Việt kèm người thực hiện", () => {
    nav.search = "tab=history";
    render(<UserDetail {...base} />);
    expect(screen.getByText(/Cấp lại mật khẩu/, { selector: "li span" })).toBeInTheDocument();
    expect(screen.getByText(/Nguyễn Văn Nam/)).toBeInTheDocument();
  });

  it("chưa có thao tác → thông báo rỗng", () => {
    nav.search = "tab=history";
    render(<UserDetail {...base} history={[]} />);
    expect(screen.getByText("Chưa có thao tác nào ghi nhận.")).toBeInTheDocument();
  });
});
