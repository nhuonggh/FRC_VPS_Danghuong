// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/shell/Sidebar";
import { APP_NAV } from "@/config/app.config";
import { buildNav } from "@/lib/nav";
import { emptyPrefs } from "@/lib/workspace";
import { WorkspaceProvider } from "@/lib/workspace-store";

let mockPath = "/system/users";
vi.mock("next/navigation", () => ({ usePathname: () => mockPath, useRouter: () => ({ push: vi.fn() }) }));

afterEach(cleanup);

const nav = buildNav(APP_NAV, new Set(["user.view", "role.manage", "audit.view"]));

describe("Sidebar", () => {
  it("module chứa chức năng đang active tự mở và đánh dấu aria-current", () => {
    mockPath = "/system/users";
    render(<WorkspaceProvider prefs={emptyPrefs()}><Sidebar nav={nav} /></WorkspaceProvider>);
    expect(screen.getByRole("link", { name: "Người dùng" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Nhóm quyền" })).not.toHaveAttribute("aria-current");
  });

  it("không có quyền → chức năng KHÔNG xuất hiện (ẩn hẳn)", () => {
    mockPath = "/system/users";
    render(<WorkspaceProvider prefs={emptyPrefs()}><Sidebar nav={nav} /></WorkspaceProvider>);
    expect(screen.queryByRole("link", { name: "Cài đặt danh mục" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Kế toán" })).toBeNull();
  });

  it("bấm chevron CHỈ thu/mở, không điều hướng; nhiều module mở độc lập", async () => {
    mockPath = "/";
    render(<WorkspaceProvider prefs={emptyPrefs()}><Sidebar nav={nav} /></WorkspaceProvider>);
    const chevron = screen.getByRole("button", { name: /Mở rộng Hệ thống/ });
    await userEvent.click(chevron);
    expect(screen.getByRole("link", { name: "Người dùng" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Thu gọn Hệ thống/ }));
    expect(screen.queryByRole("link", { name: "Người dùng" })).toBeNull();
  });
});
