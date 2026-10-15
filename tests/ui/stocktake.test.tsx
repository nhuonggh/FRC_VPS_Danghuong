// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LossAdjustForm } from "@/components/stock-adjust/LossAdjustForm";
import { StocktakeDetail } from "@/components/stocktake/StocktakeDetail";
import { StocktakeForm } from "@/components/stocktake/StocktakeForm";
import type { StocktakeDetailDTO } from "@/server/stocktake/queries";

const refresh = vi.fn(), replace = vi.fn(); const apiFetch = vi.fn(); let search = "";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace, refresh }), usePathname: () => "/inventory/stocktakes/1", useSearchParams: () => new URLSearchParams(search) }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));
beforeEach(() => { search = ""; refresh.mockReset(); replace.mockReset(); apiFetch.mockReset(); apiFetch.mockResolvedValue({ id: 1 }); });
afterEach(cleanup);

const st = (over: Partial<StocktakeDetailDTO> = {}): StocktakeDetailDTO => ({
  id: 1, code: "KK000001", at: new Date("2026-09-15T03:00:00Z"), status: "DRAFT", note: null, cancelReason: null, createdByName: "Admin",
  lines: [{ id: 1, productId: 5, productCode: "SP1", productName: "Tôn", baseUnit: "md", actualQty: "97", systemQty: "100", diff: "-3" }], ...over,
});

describe("StocktakeDetail", () => {
  it("nháp: có Sửa/Chốt/Hủy; chốt gọi API với khoá idempotency; chênh lệch âm hiển thị", async () => {
    search = "tab=lines";
    render(<StocktakeDetail st={st()} />);
    expect(screen.getByRole("link", { name: "Sửa nháp" })).toBeInTheDocument();
    expect(screen.getByText("-3")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Chốt phiếu" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/stocktakes/1/confirm", expect.objectContaining({ method: "POST", idempotencyKey: expect.any(String) })));
    expect(refresh).toHaveBeenCalled();
  });
  it("lỗi khi chốt hiện thông báo, không refresh", async () => {
    apiFetch.mockRejectedValueOnce(new Error("Chưa có giá nhập gần nhất"));
    render(<StocktakeDetail st={st()} />);
    await userEvent.click(screen.getByRole("button", { name: "Chốt phiếu" }));
    expect(await screen.findByText(/Chưa có giá nhập gần nhất/)).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
  it("đã chốt: chỉ còn Hủy phiếu; đã hủy: hiện lý do, không nút thao tác", () => {
    const { unmount } = render(<StocktakeDetail st={st({ status: "DONE" })} />);
    expect(screen.queryByRole("button", { name: "Chốt phiếu" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hủy phiếu" })).toBeInTheDocument();
    unmount();
    render(<StocktakeDetail st={st({ status: "CANCELLED", cancelReason: "đếm sai" })} />);
    expect(screen.getByText(/Lý do: đếm sai/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hủy phiếu" })).not.toBeInTheDocument();
  });
});

describe("Form", () => {
  it("kiểm kho: thiếu sản phẩm ⇒ báo lỗi, không gọi API", async () => {
    render(<StocktakeForm today="2026-09-15" />);
    await userEvent.click(screen.getByRole("button", { name: "Lưu nháp" }));
    expect(await screen.findByText("Chọn sản phẩm.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });
  it("hao hụt: bắt buộc lý do", async () => {
    render(<LossAdjustForm today="2026-09-15" />);
    await userEvent.click(screen.getByRole("button", { name: "Lưu phiếu" }));
    expect(await screen.findByText("Nhập lý do (bắt buộc).")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
