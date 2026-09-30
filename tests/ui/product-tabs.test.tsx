// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductDetail } from "@/components/products/ProductDetail";
import { ProductNewForm } from "@/components/products/ProductNewForm";
import type { ProductDetailDTO } from "@/server/products/queries";

const apiFetch = vi.fn(); let search = "";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/inventory/products/new", useSearchParams: () => new URLSearchParams(search) }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));
vi.mock("@/lib/confirm-store", () => ({ confirm: async () => true }));
beforeEach(() => { apiFetch.mockReset(); search = ""; });
afterEach(cleanup);

describe("ProductNewForm — tab dọc", () => {
  it("5 tab: Thông tin cơ bản · Đơn vị & quy đổi · Giá · Tồn kho · Lịch sử giao dịch; 3 tab cuối bị khóa", () => {
    render(<ProductNewForm />);
    const tabs = screen.getAllByRole("tab").slice(0, 5);
    expect(tabs.map((t) => t.textContent)).toEqual(["Thông tin cơ bản", "Đơn vị & quy đổi", "Giá", "Tồn kho", "Lịch sử giao dịch"]);
    expect(tabs.slice(2).every((t) => (t as HTMLButtonElement).disabled)).toBe(true);
  });
  it("thiếu mã/tên ở tab đầu nhưng đang ở tab Đơn vị ⇒ nhảy về tab đầu, không gọi API", async () => {
    render(<ProductNewForm />);
    await userEvent.click(screen.getAllByRole("tab", { name: /Đơn vị & quy đổi/ })[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await waitFor(() => expect(screen.getByLabelText(/^Mã/)).toBeVisible());
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

const product = { id: 5, code: "SP5", name: "Tôn lạnh", kind: "HANG", baseUnit: "md", minStock: "0", isCoil: false, isActive: true, note: null, unitCount: 0, units: [] } as unknown as ProductDetailDTO;
describe("ProductDetail — tab Giá và Lịch sử giao dịch", () => {
  it("tab Giá: hiện giá nhập/bán gần nhất khi có quyền; không quyền ⇒ báo rõ", async () => {
    search = "tab=price";
    const { unmount } = render(<ProductDetail product={product} canManage={false} pricing={{ canSeePurchase: true, canSeeSale: true, lastPurchase: { unitCost: "10000", at: "2026-09-01T03:00:00.000Z", docId: 1, code: "PN000001" }, lastSale: { salePrice: "55000", unit: "md", orderId: 2, orderCode: "DH000002", at: "2026-09-15T03:00:00.000Z" } }} movements={[]} />);
    expect(await screen.findByText("PN000001")).toBeInTheDocument(); expect(screen.getByText("DH000002")).toBeInTheDocument();
    unmount();
    render(<ProductDetail product={product} canManage={false} pricing={{ canSeePurchase: false, canSeeSale: false, lastPurchase: null, lastSale: null }} movements={[]} />);
    expect(await screen.findByText(/không có quyền xem giá/)).toBeInTheDocument();
  });
  it("tab Lịch sử giao dịch: liệt kê nhãn + liên kết; không có stock.view (movements=null) ⇒ không có tab", async () => {
    search = "tab=movements";
    const { unmount } = render(<ProductDetail product={product} canManage={false} movements={[{ id: 1, at: "2026-09-15T03:00:00.000Z", docType: "SALE", label: "Bán hàng", href: "/sales/orders/2", qtyIn: "0", qtyOut: "3" }]} />);
    expect(await screen.findByRole("link", { name: "Bán hàng" })).toHaveAttribute("href", "/sales/orders/2");
    unmount(); search = "";
    render(<ProductDetail product={product} canManage={false} movements={null} />);
    expect(screen.queryAllByRole("button", { name: /Lịch sử giao dịch/ })).toHaveLength(0);
  });
});
