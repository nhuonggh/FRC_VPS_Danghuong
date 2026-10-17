// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SupplierOrderNew } from "@/components/purchase/SupplierOrderNew";
import { SupplierOrderReceive } from "@/components/purchase/SupplierOrderReceive";
const api = vi.fn(), replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }), usePathname: () => "/purchase/supplier-orders/new", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => api(...args) }));
vi.mock("@/lib/confirm-store", () => ({ confirm: async () => true }));
beforeEach(() => { api.mockReset(); api.mockResolvedValue([]); replace.mockReset(); });
afterEach(cleanup);
it("shows per-product delivery dates and supplier price context on the ordering form", () => {
  render(<SupplierOrderNew today="2026-10-17" />);
  expect(screen.getByLabelText(/Ngày đặt/)).toBeVisible();
  expect(screen.getByLabelText("Dự kiến giao dòng 1")).toBeVisible();
  expect(screen.getByText("Chọn nhà cung cấp và sản phẩm để xem giá gần nhất.")).toBeVisible();
  expect(screen.queryByLabelText(/Cước vận chuyển/)).toBeNull();
});
const lines = [{ lineId: 11, label: "DH-1 · Tôn", unit: "md", ordered: "10", received: "3", remaining: "7", purchasePrice: "100" }, { lineId: 22, label: "DH-2 · Tôn", unit: "md", ordered: "5", received: "0", remaining: "5", purchasePrice: "110" }];
it("receives only selected order lines, keeping repeated products allocated to the correct order", async () => {
  render(<SupplierOrderReceive id={1} code="DH-1" today="2026-10-17" lines={lines} />);
  await userEvent.type(screen.getByLabelText("Thực nhận DH-2 · Tôn"), "2");
  await userEvent.click(screen.getByRole("button", { name: "Xác nhận nhận và nhập kho" }));
  await waitFor(() => expect(api).toHaveBeenCalledWith("/api/supplier-orders/1/receive", expect.objectContaining({ json: expect.objectContaining({ lines: [{ lineId: 22, qty: 2, purchasePrice: 110 }] }) })));
  expect(replace).toHaveBeenCalledWith("/purchase/supplier-orders/1");
});
it("requires an explicit reason before accepting excess", async () => {
  render(<SupplierOrderReceive id={1} code="DH-1" today="2026-10-17" lines={lines} />);
  await userEvent.type(screen.getByLabelText("Thực nhận DH-1 · Tôn"), "8");
  await userEvent.click(screen.getByRole("button", { name: "Xác nhận nhận và nhập kho" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Nhập lý do xác nhận nhận thừa.");
  expect(api).not.toHaveBeenCalled();
});
