// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleLanding } from "@/components/shell/ModuleLanding";
import { ModuleTabs } from "@/components/shell/ModuleTabs";
import { APP_NAV } from "@/config/app.config";
import { registerDirtyGuard } from "@/lib/dirty-guard";
import { buildNav } from "@/lib/nav";
import { emptyPrefs, setActive, togglePin, type Prefs } from "@/lib/workspace";
import { WorkspaceProvider } from "@/lib/workspace-store";
import { useConfirmStore } from "@/lib/confirm-store";

const state = vi.hoisted(() => ({ pathname: "/m/sales", push: vi.fn(), puts: [] as unknown[] }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname, useRouter: () => ({ push: state.push }) }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (_url: string, init: { json: unknown }) => { state.puts.push(init.json); return Promise.resolve({ ok: true }); } }));

const nav = buildNav(APP_NAV, new Set(APP_NAV.flatMap((m) => [m.perm, ...m.categories.flatMap((c) => c.functions.map((f) => f.perm))]).filter(Boolean) as string[]));
const sales = nav.find((m) => m.key === "sales")!;
const wrap = (prefs: Prefs, ui: React.ReactNode) => render(<WorkspaceProvider prefs={prefs}>{ui}</WorkspaceProvider>);
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); state.pathname = "/m/sales"; state.push.mockReset(); state.puts.length = 0; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ModuleTabs", () => {
  it("trang Chức năng: tab đầu cố định, đang chọn; không có nút ghim/đóng ở tab này", () => {
    wrap(togglePin(emptyPrefs(), "sales", "quote-list"), <ModuleTabs nav={nav} />);
    const tabs = screen.getAllByRole("tab"); expect(tabs.map((t) => t.textContent)).toEqual(["Chức năng", "Báo giá", "Hướng dẫn sử dụng"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true"); expect(tabs[0]).toHaveAttribute("href", "/m/sales");
    expect(screen.queryByLabelText("Bỏ ghim Chức năng")).toBeNull(); expect(screen.getByLabelText("Bỏ ghim Báo giá")).toBeInTheDocument();
  });

  it("chức năng chưa ghim đang mở ⇒ đúng MỘT tab tạm; ghim ⇒ thành tab ghim và lưu lên server", async () => {
    state.pathname = "/sales/customers";
    wrap(emptyPrefs(), <ModuleTabs nav={nav} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Chức năng", "Khách hàng", "Hướng dẫn sử dụng"]);
    expect(screen.getByRole("tab", { name: /Khách hàng/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByLabelText("Ghim Khách hàng"));
    expect(screen.getByLabelText("Bỏ ghim Khách hàng")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    const saved = state.puts.at(-1) as Prefs; expect(saved.modules.sales!.pinned).toEqual(["customer-list"]); expect(saved.modules.sales!.active).toBe("customer-list");
  });

  it("trang con (chi tiết) vẫn thuộc tab của chức năng cha", () => {
    state.pathname = "/sales/orders/12";
    wrap(togglePin(emptyPrefs(), "sales", "order-list"), <ModuleTabs nav={nav} />);
    expect(screen.getByRole("tab", { name: /Danh sách đơn/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab")).toHaveLength(3); // Chức năng + đơn đã ghim + hướng dẫn cố định, không thêm tab tạm.
  });

  it("không hiện ở trang không thuộc module accordion (Trang chủ)", () => {
    state.pathname = "/"; wrap(emptyPrefs(), <ModuleTabs nav={nav} />); expect(screen.queryByTestId("module-tabs")).toBeNull();
  });

  it("Alt+→ đổi thứ tự tab ghim và lưu", async () => {
    let p = togglePin(emptyPrefs(), "sales", "order-list"); p = togglePin(p, "sales", "quote-list");
    wrap(p, <ModuleTabs nav={nav} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: /Danh sách đơn/ }), { key: "ArrowRight", altKey: true });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Chức năng", "Báo giá", "Danh sách đơn", "Hướng dẫn sử dụng"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect((state.puts.at(-1) as Prefs).modules.sales!.pinned).toEqual(["quote-list", "order-list"]);
  });

  it("đang có dữ liệu chưa lưu: bấm tab khác bị chặn và hỏi xác nhận; đồng ý mới chuyển", async () => {
    state.pathname = "/sales/customers/new";
    const off = registerDirtyGuard(() => true);
    wrap(togglePin(emptyPrefs(), "sales", "quote-list"), <ModuleTabs nav={nav} />);
    fireEvent.click(screen.getByRole("tab", { name: /Báo giá/ }));
    await waitFor(() => expect(useConfirmStore.getState().request?.title).toBe("Bỏ thay đổi chưa lưu?"));
    expect(state.push).not.toHaveBeenCalled();
    act(() => useConfirmStore.getState().close(true));
    await waitFor(() => expect(state.push).toHaveBeenCalledWith("/sales/quotes"));
    off();
  });

  it("đang có dữ liệu chưa lưu: chọn ở lại thì không chuyển trang", async () => {
    const off = registerDirtyGuard(() => true);
    wrap(togglePin(emptyPrefs(), "sales", "quote-list"), <ModuleTabs nav={nav} />);
    fireEvent.click(screen.getByRole("tab", { name: /Báo giá/ }));
    await waitFor(() => expect(useConfirmStore.getState().request).not.toBeNull());
    act(() => useConfirmStore.getState().close(false)); await Promise.resolve();
    expect(state.push).not.toHaveBeenCalled(); off();
  });

  it("mở hướng dẫn trực tiếp: chỉ chọn tab hướng dẫn, giữ chức năng đang làm và không lưu lại sở thích", async () => {
    state.pathname = "/guide/modules/sales";
    const prefs = setActive(togglePin(emptyPrefs(), "sales", "order-list"), "sales", "order-list");
    wrap(prefs, <ModuleTabs nav={nav} />);
    const guide = screen.getByRole("tab", { name: "Hướng dẫn sử dụng" });
    expect(guide).toHaveAttribute("href", "/guide/modules/sales");
    expect(guide).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab").filter((tab) => tab.getAttribute("aria-selected") === "true")).toEqual([guide]);
    expect(screen.queryByLabelText("Ghim Hướng dẫn sử dụng")).toBeNull();
    expect(screen.queryByLabelText("Bỏ ghim Hướng dẫn sử dụng")).toBeNull();
    expect(screen.queryByLabelText("Đóng Hướng dẫn sử dụng")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(state.puts).toHaveLength(0); // Không ghi đè chức năng đã nhớ khi chỉ đọc hướng dẫn.
  });

  it("mở hướng dẫn từ form chưa lưu vẫn hỏi xác nhận trước khi chuyển", async () => {
    state.pathname = "/sales/customers/new";
    const off = registerDirtyGuard(() => true);
    try {
      wrap(emptyPrefs(), <ModuleTabs nav={nav} />);
      fireEvent.click(screen.getByRole("tab", { name: "Hướng dẫn sử dụng" }));
      await waitFor(() => expect(useConfirmStore.getState().request?.title).toBe("Bỏ thay đổi chưa lưu?"));
      expect(state.push).not.toHaveBeenCalled();
      act(() => useConfirmStore.getState().close(true));
      await waitFor(() => expect(state.push).toHaveBeenCalledWith("/guide/modules/sales"));
    } finally { off(); }
  });
});

describe("ModuleLanding (tab Chức năng) — ngôi sao yêu thích", () => {
  it("giữ card theo nhóm; bấm sao ghim/bỏ ghim mà KHÔNG mở chức năng (hai hành động độc lập)", async () => {
    wrap(emptyPrefs(), <ModuleLanding module={sales} />);
    expect(screen.getByRole("heading", { name: "Đơn hàng" })).toBeInTheDocument();
    const card = screen.getByRole("link", { name: /Báo giá/ }); expect(card).toHaveAttribute("href", "/sales/quotes");
    const star = screen.getByLabelText("Thêm Báo giá vào yêu thích"); expect(star).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(star);
    expect(screen.getByLabelText("Bỏ yêu thích Báo giá")).toHaveAttribute("aria-pressed", "true"); expect(state.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Bỏ yêu thích Báo giá")); expect(screen.getByLabelText("Thêm Báo giá vào yêu thích")).toBeInTheDocument();
  });

  it("tìm chức năng vẫn hoạt động (không dấu)", () => {
    wrap(setActive(emptyPrefs(), "sales", "quote-list"), <ModuleLanding module={sales} />);
    fireEvent.change(screen.getByLabelText("Tìm chức năng"), { target: { value: "bao gia" } });
    expect(screen.getByRole("link", { name: /Báo giá/ })).toBeInTheDocument(); expect(screen.queryByRole("link", { name: /Tiền cọc/ })).toBeNull();
  });
});
