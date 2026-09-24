// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewRoleForm } from "@/app/(app)/system/roles/new/NewRoleForm";
import { ApiError, SessionExpiredError } from "@/lib/api-fetch";

const push = vi.fn();
const replace = vi.fn();
const apiFetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace, refresh: vi.fn() }) }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

beforeEach(() => { for (const m of [push, replace, apiFetch]) m.mockReset(); });
afterEach(cleanup);

describe("NewRoleForm (/system/roles/new)", () => {
  it("tên trống → lỗi tiếng Việt (aria-invalid + aria-describedby), không gọi API", async () => {
    render(<NewRoleForm />);
    await userEvent.click(screen.getByRole("button", { name: "Tạo nhóm quyền" }));
    expect(await screen.findByText("Tên nhóm quyền tối thiểu 2 ký tự.")).toBeInTheDocument();
    const name = screen.getByLabelText("Tên nhóm quyền");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Tên nhóm quyền tối thiểu 2 ký tự.");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("gửi POST /api/roles kèm Idempotency-Key; thành công → vào thẳng phần cấu hình quyền của nhóm mới", async () => {
    apiFetch.mockResolvedValueOnce({ id: 9 });
    render(<NewRoleForm />);
    await userEvent.type(screen.getByLabelText("Tên nhóm quyền"), "Bán hàng lẻ");
    await userEvent.type(screen.getByLabelText("Mô tả"), "Cửa hàng");
    await userEvent.click(screen.getByRole("button", { name: "Tạo nhóm quyền" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/system/roles/9?edit=permissions"));
    const [url, init] = apiFetch.mock.calls[0]!;
    expect(url).toBe("/api/roles");
    expect(init).toMatchObject({ method: "POST", json: { name: "Bán hàng lẻ", description: "Cửa hàng" } });
    expect(init.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("Enter trong ô tên gửi form, chỉ 1 lần", async () => {
    apiFetch.mockResolvedValue({ id: 9 });
    render(<NewRoleForm />);
    await userEvent.type(screen.getByLabelText("Tên nhóm quyền"), "Bán hàng lẻ{Enter}{Enter}");
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("tên trùng (409) → lỗi ngay dưới ô, giữ dữ liệu; sửa rồi gửi lại cùng Idempotency-Key", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, "Tên nhóm quyền đã tồn tại.")).mockResolvedValueOnce({ id: 3 });
    render(<NewRoleForm />);
    await userEvent.type(screen.getByLabelText("Tên nhóm quyền"), "Kế toán");
    await userEvent.type(screen.getByLabelText("Mô tả"), "Ghi chú");
    await userEvent.click(screen.getByRole("button", { name: "Tạo nhóm quyền" }));
    expect(await screen.findByText("Tên nhóm quyền đã tồn tại.")).toBeInTheDocument();
    expect(screen.getByLabelText("Tên nhóm quyền")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Mô tả")).toHaveValue("Ghi chú");
    expect(replace).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText("Tên nhóm quyền"), " 2");
    await userEvent.click(screen.getByRole("button", { name: "Tạo nhóm quyền" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/system/roles/3?edit=permissions"));
    expect(apiFetch.mock.calls[1]![1].idempotencyKey).toBe(apiFetch.mock.calls[0]![1].idempotencyKey);
  });

  it("phiên hết hạn → banner, giữ dữ liệu, không chuyển trang", async () => {
    apiFetch.mockRejectedValueOnce(new SessionExpiredError());
    render(<NewRoleForm />);
    await userEvent.type(screen.getByLabelText("Tên nhóm quyền"), "Kho phụ");
    await userEvent.click(screen.getByRole("button", { name: "Tạo nhóm quyền" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Phiên đăng nhập đã hết hạn.");
    expect(screen.getByLabelText("Tên nhóm quyền")).toHaveValue("Kho phụ");
    expect(replace).not.toHaveBeenCalled();
  });

  it("lỗi khác (403…) → banner của trang, giữ dữ liệu", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(403, "Bạn không có quyền thực hiện thao tác này."));
    render(<NewRoleForm />);
    await userEvent.type(screen.getByLabelText("Tên nhóm quyền"), "Kho phụ");
    await userEvent.click(screen.getByRole("button", { name: "Tạo nhóm quyền" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("không có quyền");
    expect(screen.getByLabelText("Tên nhóm quyền")).toHaveValue("Kho phụ");
  });
});
