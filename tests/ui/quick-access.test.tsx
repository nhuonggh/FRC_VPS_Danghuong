// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickAccess } from "@/components/shell/QuickAccess";
import { APP_NAV } from "@/config/app.config";
import { buildNav } from "@/lib/nav";
import { emptyPrefs, type Prefs } from "@/lib/workspace";
import { WorkspaceProvider } from "@/lib/workspace-store";

const state = vi.hoisted(() => ({ puts: [] as unknown[] }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (_u: string, init: { json: unknown }) => { state.puts.push(init.json); return Promise.resolve({ ok: true }); } }));
const nav = buildNav(APP_NAV, new Set(["bom.manage", "company.manage", "quote.manage", "sale_price.view", "order.view"]));
const open = (prefs: Prefs = emptyPrefs()) => {
  render(<WorkspaceProvider prefs={prefs}><QuickAccess nav={nav} /></WorkspaceProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Truy cập nhanh/ }));
};
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); state.puts.length = 0; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("QuickAccess (nút trên header)", () => {
  it("mặc định: lưới thẻ chức năng hay dùng, chỉ cái có quyền, mỗi thẻ là link", () => {
    open();
    const list = within(screen.getByRole("list", { name: "Chức năng truy cập nhanh" }));
    expect(list.getByRole("link", { name: /Định mức NVL/ })).toHaveAttribute("href", "/production/bom");
    expect(list.getByRole("link", { name: /Công ty/ })).toHaveAttribute("href", "/system/company");
    expect(list.queryByRole("link", { name: /Lập phiếu nhập/ })).toBeNull();
  });

  it("Tùy chỉnh: bỏ yêu thích, thêm chức năng khác, đổi thứ tự — và lưu lên server", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Tùy chỉnh" }));
    fireEvent.click(screen.getByLabelText("Bỏ yêu thích Công ty & mẫu in"));
    expect(screen.queryByRole("link", { name: /Công ty/ })).toBeNull();
    fireEvent.click(screen.getByLabelText(/Thêm Báo giá \(Bán hàng\) vào yêu thích/));
    fireEvent.click(screen.getByLabelText("Chuyển Báo giá lên"));
    const items = within(screen.getByRole("list", { name: "Chức năng truy cập nhanh" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent).join("|")).toMatch(/Báo giá.*Định mức NVL|Định mức NVL.*Báo giá/);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    const saved = state.puts.at(-1) as Prefs;
    expect(saved.quickAccess).toContain("quote-list");
    expect(saved.quickAccess).not.toContain("company");
  });

  it("tìm chức năng để thêm (không dấu) và khôi phục mặc định", async () => {
    open({ ...emptyPrefs(), quickAccess: [] });
    expect(screen.getByText(/Chưa có chức năng nào/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tùy chỉnh" }));
    fireEvent.change(screen.getByLabelText("Tìm chức năng để thêm"), { target: { value: "bao gia" } });
    expect(screen.getByLabelText(/Thêm Báo giá/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Thêm Tiền cọc/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Khôi phục mặc định/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect((state.puts.at(-1) as Prefs).quickAccess).toBeUndefined();
  });
});
