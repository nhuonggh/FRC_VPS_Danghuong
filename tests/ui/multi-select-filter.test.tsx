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

  it("chọn 2 mục nhanh khi URL chưa kịp cập nhật → lần 2 vẫn giữ lựa chọn của lần 1 (không dựng URL từ params cũ)", async () => {
    const stale = parseListParams({}, ["role"]); // props không đổi giữa 2 lần bấm (router.push chưa hoàn tất)
    render(<MultiSelectFilter label="Nhóm quyền" paramKey="role" options={options} basePath="/system/users" params={stale} />);
    await userEvent.click(screen.getByRole("button", { name: /Nhóm quyền/ }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Giám đốc" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Kế toán" }));
    expect(push).toHaveBeenNthCalledWith(1, "/system/users?role=1");
    expect(push).toHaveBeenNthCalledWith(2, "/system/users?role=1%2C2");
    expect(screen.getByRole("menuitemcheckbox", { name: "Giám đốc" })).toBeChecked();
    expect(screen.getByRole("button", { name: /Nhóm quyền/, hidden: true })).toHaveTextContent("2"); // menu mở → phần còn lại aria-hidden
  });

  it("URL đổi từ bên ngoài (vd 'Xóa bộ lọc') → đồng bộ lại lựa chọn hiển thị", () => {
    const mk = (sp: Record<string, string>) => (
      <MultiSelectFilter label="Nhóm quyền" paramKey="role" options={options} basePath="/system/users" params={parseListParams(sp, ["role"])} />
    );
    const { rerender } = render(mk({ role: "1,2" }));
    expect(screen.getByRole("button", { name: /Nhóm quyền/ })).toHaveTextContent("2");
    rerender(mk({}));
    expect(screen.getByRole("button", { name: /Nhóm quyền/ })).not.toHaveTextContent(/\d/);
  });
});
