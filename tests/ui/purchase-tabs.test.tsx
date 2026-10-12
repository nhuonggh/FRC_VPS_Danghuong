// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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

describe("PurchaseNewForm — một trang", () => {
  it("không chia tab: NCC, ngày, cước, ghi chú và danh sách sản phẩm cùng hiện", () => {
    render(<PurchaseNewForm today="2026-09-30" />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByLabelText(/Ngày nhập/)).toBeVisible(); expect(screen.getByLabelText("Ghi chú")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Danh sách sản phẩm" })).toBeVisible();
    expect(screen.getByRole("button", { name: "+ Thêm dòng" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Chọn nhiều sản phẩm" })).toBeVisible();
  });
  it("bấm Lập phiếu khi thiếu NCC và dòng hàng: báo lỗi tại ô, không gọi API", async () => {
    render(<PurchaseNewForm today="2026-09-30" />);
    await userEvent.click(screen.getByRole("button", { name: "Lập phiếu" }));
    await waitFor(() => expect(document.querySelectorAll('[aria-invalid="true"]').length).toBeGreaterThan(0));
    expect(apiFetch).not.toHaveBeenCalled();
  });
  const product = { value: 10, label: "TX01 — Tôn xốp", hint: "md", baseUnit: "md", units: [{ unit: "md", factor: "1" }] };
  const withType = (priceBasis: "LENGTH" | "AREA", ratio: number) => apiFetch.mockImplementation(async (url: string) => (url.startsWith("/api/products/search") ? [product] : url.startsWith("/api/orders/options/processing-types") ? [{ value: 4, label: "Tôn xốp,11 sóng", ratio, priceBasis }] : []));
  const pickProductAndType = async () => {
    const box = screen.getByRole("combobox", { name: "Sản phẩm (nhập theo kích thước)" });
    await userEvent.click(box); await userEvent.type(box, "ton");
    await userEvent.click((await within(await screen.findByRole("listbox")).findAllByRole("option"))[0]!);
    await waitFor(() => expect(within(screen.getByLabelText("Kiểu gia công")).getByRole("option", { name: "Tôn xốp,11 sóng" })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Kiểu gia công"), "4");
  };
  it("kiểu tính giá theo mét dài: chỉ ô Giá nhập/md; 7.1*7+6.8*1 → 2 dòng, SL = dài × số tấm, ghi chú cuộn ghi diện tích", async () => {
    withType("LENGTH", 1.08);
    render(<PurchaseNewForm today="2026-09-30" />);
    await pickProductAndType();
    expect(screen.getByLabelText("Tỷ lệ m²/md")).toHaveValue("1,08");
    expect(screen.queryByLabelText("Giá nhập/m²")).toBeNull();
    await userEvent.type(screen.getByLabelText("Chiều dài"), "7.1*7+6.8*1");
    await userEvent.type(screen.getByLabelText("Giá nhập/md"), "162000");
    await userEvent.click(screen.getByRole("button", { name: "Thêm vào phiếu" }));
    await waitFor(() => expect(screen.getByLabelText("Số lượng dòng 2")).toHaveValue("6,8"));
    expect(screen.getByLabelText("Số lượng dòng 1")).toHaveValue("49,7");
    expect(screen.getByLabelText("Đơn giá dòng 1")).toHaveValue("162.000");
    expect(screen.getByLabelText("Ghi chú cuộn dòng 1")).toHaveValue("7,1 m × 1,08 × 7 = 53,676 m²");
    expect(screen.getByLabelText("Ghi chú cuộn dòng 2")).toHaveValue("6,8 m × 1,08 × 1 = 7,344 m²");
  });
  it("kiểu tính giá theo mét vuông: chỉ ô Giá nhập/m² (ô gốc), dòng thêm vào hiện giá/m², giá/md lưu = giá/m² × tỷ lệ", async () => {
    withType("AREA", 1.12);
    render(<PurchaseNewForm today="2026-09-30" />);
    await pickProductAndType();
    expect(screen.queryByLabelText("Giá nhập/md")).toBeNull();
    await userEvent.type(screen.getByLabelText("Giá nhập/m²"), "158125");
    const ratio = screen.getByLabelText("Tỷ lệ m²/md");
    await userEvent.clear(ratio); await userEvent.type(ratio, "1,2");
    expect(screen.getByLabelText("Giá nhập/m²")).toHaveValue("158.125");
    await userEvent.type(screen.getByLabelText("Chiều dài"), "10");
    await userEvent.click(screen.getByRole("button", { name: "Thêm vào phiếu" }));
    await waitFor(() => expect(screen.getByLabelText("Số lượng dòng 1")).toHaveValue("10"));
    expect(screen.getByLabelText("Đơn giá dòng 1")).toHaveValue("158.125");
    expect(screen.getAllByText("1.897.500 ₫").length).toBeGreaterThan(0); // 10 md × 189.750 (= 158.125 × 1,2)
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
