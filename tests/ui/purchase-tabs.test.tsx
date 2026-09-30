// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PurchaseDetail } from "@/components/purchase/PurchaseDetail";
import { PurchaseNewForm } from "@/components/purchase/PurchaseNewForm";
import type { PurchaseDetailDTO } from "@/server/purchase/queries";

const apiFetch = vi.fn(); let search = "";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/purchase/orders/new", useSearchParams: () => new URLSearchParams(search) }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));
vi.mock("@/lib/confirm-store", () => ({ confirm: async () => true }));
beforeEach(() => { apiFetch.mockReset(); apiFetch.mockResolvedValue([]); search = ""; });
afterEach(cleanup);

describe("PurchaseNewForm — tab dọc", () => {
  it("2 tab: Thông tin chung (NCC, ngày, cước, ghi chú) · Danh sách sản phẩm; chỉ tab đang chọn hiện", () => {
    render(<PurchaseNewForm today="2026-09-30" />);
    expect(screen.getAllByRole("tab").slice(0, 2).map((t) => t.textContent)).toEqual(["Thông tin chung", "Danh sách sản phẩm"]);
    expect(screen.getByLabelText(/Ngày nhập/)).toBeVisible(); expect(screen.getByLabelText("Ghi chú")).toBeVisible();
    expect(screen.getByRole("button", { name: "+ Thêm dòng", hidden: true })).not.toBeVisible();
  });
  it("bấm Lập phiếu khi thiếu NCC và dòng hàng: đánh dấu cả hai tab, dừng ở tab lỗi đầu tiên, không gọi API", async () => {
    render(<PurchaseNewForm today="2026-09-30" />);
    await userEvent.click(screen.getAllByRole("tab", { name: /Danh sách sản phẩm/ })[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Lập phiếu" }));
    await waitFor(() => expect(screen.getByLabelText(/Ngày nhập/)).toBeVisible());
    expect(screen.getAllByRole("img", { name: /có lỗi/ }).length).toBeGreaterThan(0);
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

const purchase = { id: 1, code: "PN000001", partnerId: 3, partnerCode: "NCC1", partnerName: "Tôn Phương Nam", at: "2026-09-15T03:00:00.000Z", note: null, isCancelled: false, cancelReason: null, cancelledAt: null, createdByName: "Admin", freightCost: "0", purchaseTotal: "0", lines: [] } as unknown as PurchaseDetailDTO;
describe("PurchaseDetail — tab", () => {
  it("Thông tin chung + Danh sách sản phẩm", async () => {
    search = "tab=lines";
    render(<PurchaseDetail purchase={purchase} canEdit={false} canCancel={false} date="2026-09-15" products={[]} />);
    expect(await screen.findByText("Dòng hàng")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Thông tin chung/ }).length).toBeGreaterThan(0);
  });
});
