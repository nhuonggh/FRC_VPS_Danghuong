// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RolesTable } from "@/app/(app)/system/roles/RolesTable";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/system/roles" }));

const rows = [
  { id: 1, name: "Giám đốc", description: "Toàn quyền", isSystem: true, userCount: 2, permissionCount: 50 },
  { id: 4, name: "Bán hàng lẻ", description: null, isSystem: false, userCount: 0, permissionCount: 1234 },
];

beforeEach(() => localStorage.clear());
afterEach(cleanup);
const rowOf = (name: string) => screen.getAllByRole("row").find((r) => within(r).queryByText(name))!;

describe("RolesTable", () => {
  it("dòng là liên kết tới trang chi tiết; nhóm hệ thống có huy hiệu 'Mặc định', nhóm tự tạo 'Tự tạo'", () => {
    render(<RolesTable rows={rows} canViewUsers />);
    expect(screen.getAllByRole("link", { name: "Giám đốc" })[0]).toHaveAttribute("href", "/system/roles/1");
    expect(within(rowOf("Giám đốc")).getByText("Mặc định")).toBeInTheDocument();
    expect(within(rowOf("Bán hàng lẻ")).getByText("Tự tạo")).toBeInTheDocument();
    expect(within(rowOf("Bán hàng lẻ")).getByText("—")).toBeInTheDocument(); // không có mô tả
  });

  it("số quyền dùng định dạng số (1.234)", () => {
    render(<RolesTable rows={rows} canViewUsers />);
    expect(within(rowOf("Bán hàng lẻ")).getByText("1.234")).toBeInTheDocument();
  });

  it("số người dùng > 0 là liên kết tới danh sách người dùng đã lọc theo nhóm; = 0 là chữ thường", () => {
    render(<RolesTable rows={rows} canViewUsers />);
    expect(within(rowOf("Giám đốc")).getByRole("link", { name: "2" })).toHaveAttribute("href", "/system/users?role=1");
    expect(within(rowOf("Bán hàng lẻ")).queryByRole("link", { name: "0" })).toBeNull();
    expect(within(rowOf("Bán hàng lẻ")).getByText("0")).toBeInTheDocument();
  });

  it("thiếu user.view → số người dùng không phải liên kết (tránh dẫn tới trang 403)", () => {
    render(<RolesTable rows={rows} canViewUsers={false} />);
    expect(within(rowOf("Giám đốc")).queryByRole("link", { name: "2" })).toBeNull();
    expect(within(rowOf("Giám đốc")).getByText("2")).toBeInTheDocument();
  });

  it("thao tác: Xem và Sửa quyền (mở thẳng chế độ sửa quyền)", () => {
    render(<RolesTable rows={rows} canViewUsers />);
    const r = rowOf("Bán hàng lẻ");
    expect(within(r).getByRole("link", { name: "Xem" })).toHaveAttribute("href", "/system/roles/4");
    expect(within(r).getByRole("link", { name: "Sửa quyền" })).toHaveAttribute("href", "/system/roles/4?edit=permissions");
  });
});
