// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewUserForm } from "@/app/(app)/system/users/new/NewUserForm";
import { ApiError, SessionExpiredError } from "@/lib/api-fetch";

const push = vi.fn();
const replace = vi.fn();
const apiFetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace, refresh: vi.fn() }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const roles = [
  { id: 1, name: "Giám đốc", description: "Toàn quyền" },
  { id: 2, name: "Kế toán", description: null },
];

beforeEach(() => { for (const m of [push, replace, apiFetch]) m.mockReset(); });
afterEach(cleanup);

async function fillAndSubmit({ username = "Lan.Tran", fullName = "Trần Thị Lan", role = "Kế toán" } = {}) {
  await userEvent.type(screen.getByLabelText("Tên đăng nhập"), username);
  await userEvent.type(screen.getByLabelText("Họ tên"), fullName);
  await userEvent.click(screen.getByRole("checkbox", { name: new RegExp(role) }));
  await userEvent.click(screen.getByRole("button", { name: "Tạo người dùng" }));
}

describe("NewUserForm (/system/users/new)", () => {
  it("thiếu dữ liệu → lỗi tiếng Việt từng ô, không gọi API", async () => {
    render(<NewUserForm roles={roles} />);
    await userEvent.click(screen.getByRole("button", { name: "Tạo người dùng" }));
    expect(await screen.findByText("Tên đăng nhập tối thiểu 3 ký tự.")).toBeInTheDocument();
    expect(screen.getByText("Nhập họ tên.")).toBeInTheDocument();
    expect(screen.getByText("Chọn ít nhất 1 nhóm quyền.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
    for (const [label, msg] of [["Tên đăng nhập", "Tên đăng nhập tối thiểu 3 ký tự."], ["Họ tên", "Nhập họ tên."]] as const) {
      const input = screen.getByLabelText(label);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAccessibleDescription(msg);
      expect(input).toHaveClass("h-11", "md:h-9");
    }
    expect(screen.getByRole("group", { name: "Nhóm quyền" })).toHaveAccessibleDescription("Chọn ít nhất 1 nhóm quyền.");
  });

  it("nhấn Enter trong ô nhập gửi form (như bấm nút Tạo), chỉ 1 lần dù Enter liên tiếp; giữ Idempotency-Key", async () => {
    let done!: (v: unknown) => void;
    apiFetch.mockReturnValueOnce(new Promise((r) => { done = r; }));
    render(<NewUserForm roles={roles} />);
    await userEvent.type(screen.getByLabelText("Tên đăng nhập"), "lan.tran");
    await userEvent.type(screen.getByLabelText("Họ tên"), "Trần Thị Lan");
    await userEvent.click(screen.getByRole("checkbox", { name: /Kế toán/ }));
    await userEvent.type(screen.getByLabelText("Họ tên"), "{Enter}{Enter}");
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(apiFetch.mock.calls[0]![1].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    done({ id: 8, tempPassword: "Aa1bB2cC3dD4" });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("Enter khi dữ liệu thiếu → lỗi từng ô, không gọi API", async () => {
    render(<NewUserForm roles={roles} />);
    await userEvent.type(screen.getByLabelText("Tên đăng nhập"), "{Enter}");
    expect(await screen.findByText("Nhập họ tên.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("gửi POST /api/users kèm Idempotency-Key; thành công → hộp thoại mật khẩu tạm (1 lần), đóng → sang trang chi tiết", async () => {
    apiFetch.mockResolvedValueOnce({ id: 12, tempPassword: "Zx9Kp2Lm4Qrs" });
    render(<NewUserForm roles={roles} />);
    await fillAndSubmit();
    expect(await screen.findByRole("dialog", { name: "Mật khẩu tạm của lan.tran" })).toBeInTheDocument();
    expect(screen.getByText("Zx9Kp2Lm4Qrs")).toBeInTheDocument();
    const [url, init] = apiFetch.mock.calls[0]!;
    expect(url).toBe("/api/users");
    expect(init).toMatchObject({ method: "POST", json: { username: "Lan.Tran", fullName: "Trần Thị Lan", roleIds: [2] } });
    expect(init.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(replace).not.toHaveBeenCalled(); // chưa rời trang khi người dùng chưa ghi lại mật khẩu

    await userEvent.click(screen.getByRole("button", { name: "Đã ghi lại" }));
    expect(replace).toHaveBeenCalledWith("/system/users/12");
    expect(document.body.textContent).not.toContain("Zx9Kp2Lm4Qrs");
  });

  it("phản hồi lặp (tempPassword null) → hộp thoại chỉ dẫn 'Cấp lại mật khẩu', không có mật khẩu", async () => {
    apiFetch.mockResolvedValueOnce({ id: 12, tempPassword: null });
    render(<NewUserForm roles={roles} />);
    await fillAndSubmit();
    expect(await screen.findByText(/Cấp lại mật khẩu/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sao chép mật khẩu" })).toBeNull();
  });

  it("tên đăng nhập trùng (409) → lỗi ngay dưới ô, giữ dữ liệu, không mở hộp thoại; sửa rồi gửi lại cùng Idempotency-Key", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, "Tên đăng nhập đã tồn tại.")).mockResolvedValueOnce({ id: 3, tempPassword: "Aa1bB2cC3dD4" });
    render(<NewUserForm roles={roles} />);
    await fillAndSubmit({ username: "nam" });
    const input = screen.getByLabelText("Tên đăng nhập");
    expect(await screen.findByText("Tên đăng nhập đã tồn tại.")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveValue("nam");
    expect(screen.getByLabelText("Họ tên")).toHaveValue("Trần Thị Lan");
    expect(screen.queryByRole("dialog")).toBeNull();

    await userEvent.type(input, "2");
    await userEvent.click(screen.getByRole("button", { name: "Tạo người dùng" }));
    await screen.findByRole("dialog");
    expect(apiFetch.mock.calls[1]![1].idempotencyKey).toBe(apiFetch.mock.calls[0]![1].idempotencyKey);
    expect(apiFetch.mock.calls[1]![1].json.username).toBe("nam2");
  });

  it("phiên hết hạn (401) → giữ nguyên dữ liệu đã nhập, không chuyển trang, không mở hộp thoại", async () => {
    apiFetch.mockRejectedValueOnce(new SessionExpiredError());
    render(<NewUserForm roles={roles} />);
    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Phiên đăng nhập đã hết hạn.");
    expect(screen.getByLabelText("Tên đăng nhập")).toHaveValue("Lan.Tran");
    expect(screen.getByRole("checkbox", { name: /Kế toán/ })).toBeChecked();
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lỗi khác (vd 403 leo thang đặc quyền) → banner của trang, giữ dữ liệu", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(403, "Bạn không thể gán nhóm quyền vượt quá quyền của mình."));
    render(<NewUserForm roles={roles} />);
    await fillAndSubmit({ role: "Giám đốc" });
    expect(await screen.findByRole("alert")).toHaveTextContent("vượt quá quyền của mình");
    expect(screen.getByLabelText("Họ tên")).toHaveValue("Trần Thị Lan");
  });

  it("chọn/bỏ chọn nhóm quyền cập nhật roleIds", async () => {
    apiFetch.mockResolvedValueOnce({ id: 1, tempPassword: "Aa1bB2cC3dD4" });
    render(<NewUserForm roles={roles} />);
    await userEvent.click(screen.getByRole("checkbox", { name: /Giám đốc/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Kế toán/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Giám đốc/ })); // bỏ chọn
    await userEvent.type(screen.getByLabelText("Tên đăng nhập"), "abc");
    await userEvent.type(screen.getByLabelText("Họ tên"), "An Bình");
    await userEvent.click(screen.getByRole("button", { name: "Tạo người dùng" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(apiFetch.mock.calls[0]![1].json.roleIds).toEqual([2]);
  });
});
