// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoleDetail } from "@/app/(app)/system/roles/[id]/RoleDetail";
import { ApiError, SessionExpiredError } from "@/lib/api-fetch";
import { useToastStore } from "@/lib/toast";

const nav = vi.hoisted(() => ({ search: "", refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: nav.refresh, push: nav.push, replace: nav.replace }),
  usePathname: () => "/system/roles/4",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const confirm = vi.fn();
const apiFetch = vi.fn();
vi.mock("@/lib/confirm-store", () => ({ confirm: (...a: unknown[]) => confirm(...a) }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const catalog = [
  { code: "user.view", label: "Xem người dùng", group: "Hệ thống" },
  { code: "role.manage", label: "Cấu hình nhóm quyền", group: "Hệ thống" },
  { code: "cost.view", label: "Xem giá vốn", group: "Dữ liệu nhạy cảm", sensitive: true },
  { code: "order.view", label: "Xem đơn hàng", group: "Bán hàng" },
  { code: "order.create", label: "Tạo đơn hàng", group: "Bán hàng" },
];
const base: React.ComponentProps<typeof RoleDetail> = {
  role: {
    id: 4, name: "Bán hàng", description: "Nhân viên bán hàng", isSystem: false,
    permissionCodes: ["order.view", "order.create"],
    users: [],
  },
  catalog,
  actorPerms: ["user.view", "role.manage", "cost.view", "order.view", "order.create"], // như Giám đốc
  canViewUsers: true,
};
const withUsers = { ...base.role, users: [{ id: 7, username: "lan.tran", fullName: "Trần Thị Lan", isLocked: false }, { id: 8, username: "ha", fullName: "Hà", isLocked: true }] };
const toasts = () => useToastStore.getState().items;

beforeEach(() => {
  nav.search = "";
  for (const m of [nav.refresh, nav.push, nav.replace, confirm, apiFetch]) m.mockReset();
  useToastStore.setState({ items: [] });
});
afterEach(cleanup);

describe("RoleDetail — tóm tắt & xem", () => {
  it("nhóm tự tạo: huy hiệu 'Tự tạo', số quyền/người dùng; tab Thông tin là chữ tĩnh (không ô nhập)", () => {
    render(<RoleDetail {...base} />);
    expect(screen.getByRole("heading", { level: 1, name: "Bán hàng" })).toBeInTheDocument();
    expect(screen.getByText("Tự tạo")).toBeInTheDocument();
    expect(screen.getByText("Nhân viên bán hàng", { selector: "dd" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("nhóm hệ thống: huy hiệu 'Mặc định', KHÔNG có nút Xóa nhóm", () => {
    render(<RoleDetail {...base} role={{ ...base.role, name: "Giám đốc", isSystem: true }} />);
    expect(screen.getByText("Mặc định")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xóa nhóm/ })).toBeNull();
  });

  it("tab Quyền (xem): chỉ liệt kê quyền đang có, theo nhóm chức năng; quyền nhạy cảm được đánh dấu", () => {
    nav.search = "tab=permissions";
    render(<RoleDetail {...base} role={{ ...base.role, permissionCodes: ["order.view", "cost.view"] }} />);
    expect(screen.getByText("Xem đơn hàng")).toBeInTheDocument();
    expect(screen.getByText("Xem giá vốn")).toBeInTheDocument();
    expect(screen.queryByText("Tạo đơn hàng")).toBeNull();
    expect(screen.getByText("Nhạy cảm")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Bán hàng/ })).toHaveTextContent("1/2");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("RoleDetail — sửa thông tin", () => {
  it("lưu → PATCH section 'info' và LUÔN gửi description (rỗng = xóa mô tả có chủ đích, không phải bỏ sót)", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true });
    render(<RoleDetail {...base} role={{ ...base.role, description: null }} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa thông tin nhóm" }));
    const name = screen.getByLabelText("Tên nhóm quyền");
    await userEvent.clear(name);
    await userEvent.type(name, "Bán hàng lẻ");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/roles/4/section-update", { method: "PATCH", json: { section: "info", name: "Bán hàng lẻ", description: "" } }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(toasts().map((t) => t.message)).toContain("Đã lưu thay đổi.");
  });

  it("nhóm hệ thống: ô tên bị khoá kèm giải thích, vẫn gửi đúng tên cũ khi đổi mô tả", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true });
    render(<RoleDetail {...base} role={{ ...base.role, name: "Giám đốc", isSystem: true, description: "Toàn quyền" }} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa thông tin nhóm" }));
    const name = screen.getByLabelText("Tên nhóm quyền");
    expect(name).toBeDisabled();
    expect(name).toHaveAccessibleDescription("Nhóm mặc định của hệ thống không đổi tên.");
    const desc = screen.getByLabelText("Mô tả");
    await userEvent.clear(desc);
    await userEvent.type(desc, "Ban giám đốc");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/roles/4/section-update", { method: "PATCH", json: { section: "info", name: "Giám đốc", description: "Ban giám đốc" } }));
  });

  it("tên quá ngắn → lỗi dưới ô (aria-invalid + aria-describedby), không gọi API", async () => {
    render(<RoleDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa thông tin nhóm" }));
    await userEvent.clear(screen.getByLabelText("Tên nhóm quyền"));
    await userEvent.type(screen.getByLabelText("Tên nhóm quyền"), "A");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByText("Tên nhóm quyền tối thiểu 2 ký tự.")).toBeInTheDocument();
    const name = screen.getByLabelText("Tên nhóm quyền");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Tên nhóm quyền tối thiểu 2 ký tự.");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("tên trùng (409 từ máy chủ) → khung cảnh báo, vẫn ở chế độ sửa", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, "Tên nhóm quyền đã tồn tại."));
    render(<RoleDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa thông tin nhóm" }));
    await userEvent.type(screen.getByLabelText("Tên nhóm quyền"), " 2");
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tên nhóm quyền đã tồn tại.");
    expect(screen.getByRole("button", { name: "Lưu" })).toBeEnabled();
  });
});

describe("RoleDetail — ma trận quyền", () => {
  const editPerms = async () => {
    nav.search = "tab=permissions";
    render(<RoleDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa quyền" }));
  };

  it("?edit=permissions mở thẳng chế độ sửa quyền (dùng sau khi tạo nhóm)", () => {
    nav.search = "edit=permissions";
    render(<RoleDetail {...base} />);
    expect(screen.getByRole("checkbox", { name: "Xem đơn hàng" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Lưu" })).toBeInTheDocument();
  });

  it("nhóm theo chức năng: mỗi nhóm một fieldset, ô đánh dấu theo quyền hiện có, quyền nhạy cảm được ghi chú", async () => {
    await editPerms();
    expect(screen.getByRole("group", { name: /Bán hàng/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Xem đơn hàng" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Xem người dùng" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Xem giá vốn" })).toHaveAccessibleDescription(/Nhạy cảm/);
  });

  it("bật quyền + tắt quyền → gửi đúng danh sách mã; lưu xong toast + làm mới", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true });
    await editPerms();
    await userEvent.click(screen.getByRole("checkbox", { name: "Xem giá vốn" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Tạo đơn hàng" }));
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const [url, init] = apiFetch.mock.calls[0]!;
    expect(url).toBe("/api/roles/4/section-update");
    expect(init).toMatchObject({ method: "PATCH", json: { section: "permissions" } });
    expect([...init.json.codes].sort()).toEqual(["cost.view", "order.view"]);
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
  });

  it("tắt rồi bật lại cùng một quyền → trở về đúng tập gốc: KHÔNG dirty, Hủy không hỏi xác nhận", async () => {
    await editPerms();
    await userEvent.click(screen.getByRole("checkbox", { name: "Xem đơn hàng" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Xem đơn hàng" }));
    await userEvent.click(screen.getByRole("button", { name: "Hủy chỉnh sửa" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Chỉnh sửa quyền" })).toBeInTheDocument(); // đã thoát chế độ sửa
  });

  it("thứ tự mã từ máy chủ khác thứ tự danh mục vẫn không gây dirty giả (bật/tắt lại quyền khác)", async () => {
    nav.search = "tab=permissions";
    render(<RoleDetail {...base} role={{ ...base.role, permissionCodes: ["order.create", "user.view", "order.view"] }} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa quyền" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Xem người dùng" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Xem người dùng" }));
    await userEvent.click(screen.getByRole("button", { name: "Hủy chỉnh sửa" }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("bật/tắt thật sự thay đổi → vẫn dirty (Hủy hỏi xác nhận); danh sách gửi đi theo thứ tự danh mục", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true });
    confirm.mockResolvedValueOnce(false);
    await editPerms();
    await userEvent.click(screen.getByRole("checkbox", { name: "Xem người dùng" }));
    await userEvent.click(screen.getByRole("button", { name: "Hủy chỉnh sửa" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("checkbox", { name: "Xem giá vốn" }));
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(apiFetch.mock.calls[0]![1].json.codes).toEqual(["user.view", "cost.view", "order.view", "order.create"]);
  });

  it("'Chọn cả nhóm' bật mọi quyền trong nhóm; bấm lại thành 'Bỏ chọn nhóm' và tắt hết", async () => {
    await editPerms();
    await userEvent.click(screen.getByRole("button", { name: "Chọn cả nhóm Hệ thống" }));
    expect(screen.getByRole("checkbox", { name: "Xem người dùng" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Cấu hình nhóm quyền" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Xem đơn hàng" })).toBeChecked(); // nhóm khác không đổi
    await userEvent.click(screen.getByRole("button", { name: "Bỏ chọn nhóm Hệ thống" }));
    expect(screen.getByRole("checkbox", { name: "Xem người dùng" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Xem đơn hàng" })).toBeChecked();
  });

  it("người sửa KHÔNG có quyền nào đó và nhóm chưa có → ô bị vô hiệu (không ẩn) kèm giải thích; chọn cả nhóm bỏ qua ô đó", async () => {
    nav.search = "tab=permissions";
    render(<RoleDetail {...base} actorPerms={["role.manage", "order.view", "order.create", "user.view"]} />); // thiếu cost.view
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa quyền" }));
    const cost = screen.getByRole("checkbox", { name: "Xem giá vốn" });
    expect(cost).toBeDisabled();
    expect(cost).not.toBeChecked();
    expect(cost).toHaveAccessibleDescription(/Bạn không có quyền này nên không thể cấp/);
    // nhóm chỉ còn ô bị vô hiệu → không có nút chọn cả nhóm
    expect(screen.queryByRole("button", { name: /nhóm Dữ liệu nhạy cảm/ })).toBeNull();
  });

  it("quyền ĐÃ có trong nhóm dù người sửa không có → vẫn cho bỏ (gỡ quyền được phép) và bật lại (không phải thêm mới)", async () => {
    nav.search = "tab=permissions";
    render(<RoleDetail {...base} role={{ ...base.role, permissionCodes: ["order.view", "cost.view"] }} actorPerms={["role.manage", "order.view"]} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa quyền" }));
    const cost = screen.getByRole("checkbox", { name: "Xem giá vốn" });
    expect(cost).toBeEnabled();
    expect(cost).toBeChecked();
    await userEvent.click(cost);
    expect(cost).not.toBeChecked();
    await userEvent.click(cost);
    expect(cost).toBeChecked();
    // còn 'Tạo đơn hàng' người sửa không có, nhóm chưa có → vô hiệu
    expect(screen.getByRole("checkbox", { name: "Tạo đơn hàng" })).toBeDisabled();
  });

  it("'Chọn cả nhóm' chỉ thêm ô được phép; nhóm có ô vô hiệu vẫn 'chọn hết' được phần còn lại", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true });
    nav.search = "tab=permissions";
    render(<RoleDetail {...base} role={{ ...base.role, permissionCodes: [] }} actorPerms={["role.manage", "order.view", "user.view"]} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa quyền" }));
    await userEvent.click(screen.getByRole("button", { name: "Chọn cả nhóm Bán hàng" }));
    expect(screen.getByRole("checkbox", { name: "Xem đơn hàng" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Tạo đơn hàng" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Bỏ chọn nhóm Bán hàng" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    await waitFor(() => expect(apiFetch.mock.calls[0]![1].json).toEqual({ section: "permissions", codes: ["order.view"] }));
  });

  it("máy chủ từ chối cấp quyền vượt mức (403) → banner tiếng Việt, giữ nguyên lựa chọn để sửa", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(403, "Bạn không thể cấp quyền mà chính bạn không có: Xem giá vốn (cost.view)."));
    await editPerms();
    await userEvent.click(screen.getByRole("checkbox", { name: "Xem giá vốn" }));
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Bạn không thể cấp quyền mà chính bạn không có");
    expect(screen.getByRole("checkbox", { name: "Xem giá vốn" })).toBeChecked();
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("hạ quyền làm hết quản trị viên (409) → banner lỗi, không làm mới", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, "Hệ thống phải còn ít nhất một tài khoản đang hoạt động có quyền quản lý người dùng."));
    await editPerms();
    await userEvent.click(screen.getByRole("checkbox", { name: "Xem đơn hàng" }));
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("còn ít nhất một tài khoản");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("phiên hết hạn khi lưu → banner, không chuyển trang, giữ lựa chọn", async () => {
    apiFetch.mockRejectedValueOnce(new SessionExpiredError());
    await editPerms();
    await userEvent.click(screen.getByRole("checkbox", { name: "Xem giá vốn" }));
    await userEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Phiên đăng nhập đã hết hạn.");
    expect(screen.getByRole("checkbox", { name: "Xem giá vốn" })).toBeChecked();
    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("đang sửa có thay đổi chưa lưu, đổi tab → hỏi xác nhận bỏ thay đổi; từ chối → ở lại", async () => {
    confirm.mockResolvedValueOnce(false);
    await editPerms();
    await userEvent.click(screen.getByRole("checkbox", { name: "Xem giá vốn" }));
    await userEvent.click(screen.getAllByRole("button", { name: /^Người dùng/ })[0]!);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Bỏ thay đổi chưa lưu?", danger: true }));
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Xem giá vốn" })).toBeChecked();
  });

  it("chưa thay đổi gì thì đổi tab không hỏi", async () => {
    await editPerms();
    await userEvent.click(screen.getAllByRole("button", { name: /^Người dùng/ })[0]!);
    expect(confirm).not.toHaveBeenCalled();
    expect(nav.push).toHaveBeenCalledWith("/system/roles/4?tab=users");
  });
});

describe("RoleDetail — người dùng của nhóm", () => {
  it("liệt kê người dùng kèm liên kết chi tiết, đánh dấu tài khoản khóa; có liên kết sang danh sách lọc theo nhóm", () => {
    nav.search = "tab=users";
    render(<RoleDetail {...base} role={withUsers} />);
    expect(screen.getByRole("link", { name: "Trần Thị Lan" })).toHaveAttribute("href", "/system/users/7");
    expect(screen.getByText("Đã khóa")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Xem trong danh sách người dùng/ })).toHaveAttribute("href", "/system/users?role=4");
  });

  it("thiếu user.view → tên là chữ thường, không liên kết (tránh dẫn tới trang 403)", () => {
    nav.search = "tab=users";
    render(<RoleDetail {...base} role={withUsers} canViewUsers={false} />);
    expect(screen.getByText("Trần Thị Lan")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Trần Thị Lan" })).toBeNull();
    expect(screen.queryByRole("link", { name: /danh sách người dùng/ })).toBeNull();
  });

  it("nhóm chưa có ai → thông báo rỗng", () => {
    nav.search = "tab=users";
    render(<RoleDetail {...base} />);
    expect(screen.getByText("Chưa có người dùng nào thuộc nhóm này.")).toBeInTheDocument();
  });

  it("số người dùng ở thẻ tóm tắt dùng định dạng số và liên kết tới danh sách lọc theo nhóm", () => {
    render(<RoleDetail {...base} role={{ ...base.role, users: Array.from({ length: 1234 }, (_, i) => ({ id: i + 1, username: `u${i}`, fullName: `N${i}`, isLocked: false })) }} />);
    const aside = screen.getByRole("heading", { level: 1 }).closest("aside")!;
    expect(within(aside).getByRole("link", { name: "1.234" })).toHaveAttribute("href", "/system/users?role=4");
  });
});

describe("RoleDetail — xóa nhóm", () => {
  it("nhóm tự tạo, chưa có ai: nút 'Xóa nhóm' → xác nhận nguy hiểm → DELETE → toast, về danh sách", async () => {
    confirm.mockResolvedValueOnce(true);
    apiFetch.mockResolvedValueOnce({ ok: true });
    render(<RoleDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Xóa nhóm" }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Xóa nhóm quyền “Bán hàng”?", confirmLabel: "Xóa", danger: true }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/roles/4", { method: "DELETE" }));
    expect(toasts().map((t) => t.message)).toContain("Đã xóa nhóm quyền.");
    expect(nav.replace).toHaveBeenCalledWith("/system/roles");
  });

  it("hủy xác nhận → không gọi API", async () => {
    confirm.mockResolvedValueOnce(false);
    render(<RoleDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Xóa nhóm" }));
    expect(apiFetch).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("nhóm còn người dùng: nút Xóa ẩn hẳn, kèm hướng dẫn ở tab Người dùng", () => {
    nav.search = "tab=users";
    render(<RoleDetail {...base} role={withUsers} />);
    expect(screen.queryByRole("button", { name: /Xóa nhóm/ })).toBeNull();
    expect(screen.getByText(/chuyển .* sang nhóm khác trước khi xóa/i)).toBeInTheDocument();
  });

  it("máy chủ từ chối (vd đua: vừa có người được gán) → toast lỗi bền, KHÔNG rời trang", async () => {
    confirm.mockResolvedValueOnce(true);
    apiFetch.mockRejectedValueOnce(new ApiError(409, "Nhóm quyền đang có 1 người dùng — hãy chuyển họ sang nhóm khác trước."));
    render(<RoleDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Xóa nhóm" }));
    await waitFor(() => expect(toasts()).toEqual([expect.objectContaining({ kind: "error", message: expect.stringContaining("đang có 1 người dùng") })]));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("phiên hết hạn khi xóa → không thêm toast trùng, không chuyển trang", async () => {
    confirm.mockResolvedValueOnce(true);
    apiFetch.mockRejectedValueOnce(new SessionExpiredError());
    render(<RoleDetail {...base} />);
    await userEvent.click(screen.getByRole("button", { name: "Xóa nhóm" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(toasts()).toEqual([]);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("nút Xóa chạm ≥44px trên mobile", () => {
    render(<RoleDetail {...base} />);
    expect(screen.getByRole("button", { name: "Xóa nhóm" })).toHaveClass("h-11", "md:h-10");
  });
});
