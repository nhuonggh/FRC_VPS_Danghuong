// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MultiSelectFilter } from "@/components/ui/MultiSelectFilter";
import { parseListParams } from "@/lib/query-params";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); push.mockClear(); });

const options = [{ value: "1", label: "Giám đốc" }, { value: "2", label: "Kế toán" }];

describe("MultiSelectFilter", () => {
  it("hiện số đã chọn; chọn thêm → URL nối bằng dấu phẩy, về trang 1", async () => {
    render(<MultiSelectFilter label="Nhóm quyền" paramKey="role" options={options} basePath="/system/users" params={parseListParams({ role: "1", page: "3" }, ["role"])} />);
    expect(screen.getByRole("button", { name: /Nhóm quyền/ })).toHaveTextContent("1");
    await userEvent.click(screen.getByRole("button", { name: /Nhóm quyền/ }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Kế toán" }));
    expect(push).toHaveBeenCalledWith("/system/users?role=1%2C2");
  });

  it("bỏ chọn giá trị cuối → gỡ khoá khỏi URL", async () => {
    render(<MultiSelectFilter label="Nhóm quyền" paramKey="role" options={options} basePath="/system/users" params={parseListParams({ role: "1" }, ["role"])} />);
    await userEvent.click(screen.getByRole("button", { name: /Nhóm quyền/ }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Giám đốc" }));
    expect(push).toHaveBeenCalledWith("/system/users");
  });

  it("giữ nguyên các bộ lọc/tìm kiếm khác khi đổi lựa chọn", async () => {
    render(<MultiSelectFilter label="Nhóm quyền" paramKey="role" options={options} basePath="/system/users"
      params={parseListParams({ q: "nam", status: "active" }, ["role", "status"])} />);
    await userEvent.click(screen.getByRole("button", { name: /Nhóm quyền/ }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Kế toán" }));
    expect(push).toHaveBeenCalledWith("/system/users?q=nam&status=active&role=2");
  });

  it("chưa chọn gì: không hiện số; mục đã chọn có trạng thái checked", async () => {
    render(<MultiSelectFilter label="Nhóm quyền" paramKey="role" options={options} basePath="/system/users" params={parseListParams({ role: "2" }, ["role"])} />);
    await userEvent.click(screen.getByRole("button", { name: /Nhóm quyền/ }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Kế toán" })).toBeChecked();
    expect(screen.getByRole("menuitemcheckbox", { name: "Giám đốc" })).not.toBeChecked();
  });

  it("menu không đóng sau mỗi lần chọn (chọn nhiều liên tiếp)", async () => {
    render(<MultiSelectFilter label="Nhóm quyền" paramKey="role" options={options} basePath="/system/users" params={parseListParams({}, ["role"])} />);
    expect(screen.getByRole("button", { name: /Nhóm quyền/ })).not.toHaveTextContent(/\d/);
    await userEvent.click(screen.getByRole("button", { name: /Nhóm quyền/ }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Giám đốc" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Kế toán" })).toBeInTheDocument();
  });
});
