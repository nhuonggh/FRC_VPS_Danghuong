// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuoteDetail } from "@/components/sales/QuoteDetail";
import type { QuoteDetailDTO } from "@/server/quotes/queries";

const refresh = vi.fn();
const push = vi.fn();
const apiFetch = vi.fn();
const confirmFn = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh }),
  usePathname: () => "/sales/quotes/1",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));
vi.mock("@/lib/confirm-store", () => ({ confirm: (...a: unknown[]) => confirmFn(...a) }));

beforeEach(() => { refresh.mockReset(); push.mockReset(); apiFetch.mockReset(); confirmFn.mockReset(); });
afterEach(cleanup);

const quote = (over: Partial<QuoteDetailDTO> = {}): QuoteDetailDTO => ({
  id: 1, code: "BG000001", at: new Date("2026-09-10T03:00:00Z"), status: "SENT", partnerId: 1, partnerCode: "KH000001", partnerName: "Nguyễn Văn Đạt",
  quoteTotal: "300000", note: null, createdByName: "An", convertedOrder: null,
  lines: [{ id: 1, productCode: "TX01", productName: "Tôn xốp", unit: "md", qty: "10", note: null, salePrice: "30000", lineAmount: "300000" }],
  ...over,
} as QuoteDetailDTO);

describe("QuoteDetail", () => {
  it("báo giá đã gửi: Sửa / Hủy / Chuyển thành đơn; chuyển thành đơn → gọi API rồi sang đơn nháp", async () => {
    confirmFn.mockResolvedValue(true);
    apiFetch.mockResolvedValue({ orderId: 5 });
    render(<QuoteDetail quote={quote()} canManage canConvert />);
    expect(screen.getByRole("link", { name: "Sửa" })).toHaveAttribute("href", "/sales/quotes/1/edit");
    await userEvent.click(screen.getByRole("button", { name: "Chuyển thành đơn" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/quotes/1/convert", { method: "POST" }));
    expect(push).toHaveBeenCalledWith("/sales/orders/5");
  });

  it("báo giá nháp: có 'Đánh dấu đã gửi'", async () => {
    apiFetch.mockResolvedValue({});
    render(<QuoteDetail quote={quote({ status: "DRAFT" })} canManage canConvert />);
    await userEvent.click(screen.getByRole("button", { name: "Đánh dấu đã gửi" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/quotes/1/status", { method: "POST", json: { status: "SENT" } }));
  });

  it("đã chuyển thành đơn / đã hủy: không còn nút thao tác", () => {
    render(<QuoteDetail quote={quote({ status: "CONVERTED", convertedOrder: { id: 5, code: "DH000005" } })} canManage canConvert />);
    expect(screen.queryByRole("button", { name: "Chuyển thành đơn" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Sửa" })).toBeNull();
  });

  it("không có quyền: ẩn thao tác; không có quyền tạo đơn: ẩn Chuyển thành đơn", () => {
    render(<QuoteDetail quote={quote()} canManage={false} canConvert={false} />);
    for (const n of ["Chuyển thành đơn", "Hủy báo giá", "Đánh dấu đã gửi"]) expect(screen.queryByRole("button", { name: n })).toBeNull();
    expect(screen.queryByRole("link", { name: "Sửa" })).toBeNull();
  });
});
