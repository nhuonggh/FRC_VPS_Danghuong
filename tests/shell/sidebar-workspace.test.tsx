// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FavoritesMenu } from "@/components/shell/FavoritesMenu";
import { Sidebar } from "@/components/shell/Sidebar";
import { APP_NAV } from "@/config/app.config";
import { buildNav } from "@/lib/nav";
import { emptyPrefs, setActive, setSidebarCollapsed, togglePin, type Prefs } from "@/lib/workspace";
import { WorkspaceProvider } from "@/lib/workspace-store";

const state = vi.hoisted(() => ({ puts: [] as unknown[] }));
vi.mock("next/navigation", () => ({ usePathname: () => "/sales/orders", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (_u: string, init: { json: unknown }) => { state.puts.push(init.json); return Promise.resolve({ ok: true }); } }));
const nav = buildNav(APP_NAV, new Set(APP_NAV.flatMap((m) => [m.perm, ...m.categories.flatMap((c) => c.functions.map((f) => f.perm))]).filter(Boolean) as string[]));
const wrap = (prefs: Prefs) => render(<WorkspaceProvider prefs={prefs}><Sidebar nav={nav} /></WorkspaceProvider>);
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); state.puts.length = 0; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Sidebar + không gian làm việc", () => {
  it("Yêu thích không còn nằm trong sidebar mà là dropdown trên header; không ghim gì ⇒ không hiện nút", () => {
    const withMenu = (prefs: Prefs) => render(<WorkspaceProvider prefs={prefs}><Sidebar nav={nav} /><FavoritesMenu nav={nav} /></WorkspaceProvider>);
    withMenu(emptyPrefs()); expect(screen.queryByTitle("Yêu thích")).toBeNull(); cleanup();
    withMenu(togglePin(emptyPrefs(), "sales", "quote-list"));
    expect(screen.getByTitle("Yêu thích")).toBeInTheDocument(); expect(screen.queryByLabelText("Yêu thích")).toBeNull();
  });

  it("bấm module ⇒ về chức năng đang làm dở nếu còn hợp lệ, không thì trang Chức năng", () => {
    const moduleLink = () => screen.getByTitle("Bán hàng");
    wrap(setActive(emptyPrefs(), "sales", "quote-list"));
    expect(moduleLink()).toHaveAttribute("href", "/sales/quotes");
    cleanup(); wrap(setActive(emptyPrefs(), "sales", "da-bi-xoa"));
    expect(moduleLink()).toHaveAttribute("href", "/m/sales");
  });

  it("thu gọn/mở rộng sidebar được lưu theo tài khoản (gửi lên server), không dùng localStorage", async () => {
    wrap(setSidebarCollapsed(emptyPrefs(), false)); const before = Object.keys(localStorage).length;
    fireEvent.click(screen.getByLabelText("Thu gọn thanh bên"));
    expect(screen.getByLabelText("Mở rộng thanh bên")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect((state.puts.at(-1) as Prefs).sidebarCollapsed).toBe(true); expect(Object.keys(localStorage).length).toBe(before);
  });
});
