// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductionOrderDetail } from "@/components/production/ProductionOrderDetail";
import { ProductionOrderForm } from "@/components/production/ProductionOrderForm";
import type { ProductionDetailDTO } from "@/server/production/queries";

const refresh = vi.fn(), replace = vi.fn(); const apiFetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace, refresh }), usePathname: () => "/production/orders/1", useSearchParams: () => new URLSearchParams("") }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));
beforeEach(() => { refresh.mockReset(); replace.mockReset(); apiFetch.mockReset(); });
afterEach(cleanup);

const order = (over: Partial<ProductionDetailDTO> = {}): ProductionDetailDTO => ({
  id: 1, code: "SX000001", at: new Date("2026-09-15T03:00:00Z"), productCode: "PK1", productName: "Nóc", qty: "10", baseUnit: "cái", isCancelled: false, createdByName: "Admin",
  note: "ghi chú", cancelReason: null, materials: [{ id: 1, productCode: "TON1", productName: "Tôn cuộn", baseUnit: "md", qty: "20" }], ...over,
});

describe("ProductionOrderDetail", () => {
  it("không có cost.view ⇒ không hiện giá thành/vốn; có ⇒ hiện", () => {
    const { unmount } = render(<ProductionOrderDetail order={order()} />);
    expect(screen.queryByText("Giá thành/đv")).not.toBeInTheDocument();
    unmount();
    render(<ProductionOrderDetail order={order({ unitCost: "22000", totalCost: "220000", materials: [{ id: 1, productCode: "TON1", productName: "Tôn cuộn", baseUnit: "md", qty: "20", unitCost: "200000" }] })} />);
    expect(screen.getByText("Giá thành/đv")).toBeInTheDocument();
  });
  it("hủy lệnh cần lý do và gọi API", async () => {
    render(<ProductionOrderDetail order={order()} />);
    await userEvent.click(screen.getByRole("button", { name: "Hủy lệnh" }));
    await userEvent.type(screen.getByRole("textbox"), "nhập nhầm");
    await userEvent.click(screen.getAllByRole("button", { name: "Hủy lệnh" }).at(-1)!);
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/production/orders/1/cancel", expect.objectContaining({ method: "POST", json: { reason: "nhập nhầm" } })));
  });
  it("lệnh đã hủy: hiện lý do, không còn nút hủy", () => {
    render(<ProductionOrderDetail order={order({ isCancelled: true, cancelReason: "sai" })} />);
    expect(screen.getByText(/Lý do: sai/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hủy lệnh" })).not.toBeInTheDocument();
  });
});

describe("ProductionOrderForm", () => {
  it("thiếu phụ kiện/số lượng ⇒ báo lỗi, không gọi API", async () => {
    render(<ProductionOrderForm today="2026-09-15" />);
    await userEvent.click(screen.getByRole("button", { name: "Lưu lệnh" }));
    expect(await screen.findByText("Chọn phụ kiện cần sản xuất.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
