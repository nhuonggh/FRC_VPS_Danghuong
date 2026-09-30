// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaleOrderForm } from "@/components/sales/SaleOrderForm";

const replace = vi.fn();
const apiFetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }), usePathname: () => "/sales/orders/new", useSearchParams: () => new URLSearchParams("") }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const PRODUCT = { value: 10, label: "TX01 — Tôn xốp", hint: "md", baseUnit: "md", units: [{ unit: "md", factor: "1" }] };
let pricing: unknown;

beforeEach(() => {
  replace.mockReset(); apiFetch.mockReset();
  pricing = { productId: 10, baseUnit: "md", units: [{ unit: "md", factor: "1", suggestedPrice: "30000" }], onHand: "10", lastSalePrice: "30000", lastSalePriceForPartner: true };
  apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (url.startsWith("/api/partner-lists/customers/search")) return [{ value: 7, label: "KH000007 — Nguyễn Văn Đạt" }];
    if (url.startsWith("/api/products/search")) return [PRODUCT];
    if (url.startsWith("/api/orders/options/processing-types")) return [];
    if (url.startsWith("/api/orders/pricing")) return pricing;
    if (url === "/api/orders" && init?.method === "POST") return { id: 5, code: "DH000005" };
    throw new Error(`unexpected ${url}`);
  });
});
afterEach(cleanup);

async function pick(name: string, text: string) {
  const box = screen.getByRole("combobox", { name });
  await userEvent.click(box);
  await userEvent.type(box, text);
  // Chỉ chọn trong danh sách của combobox (các <select> cũng có role option)
  await userEvent.click((await within(await screen.findByRole("listbox")).findAllByRole("option"))[0]!);
}
const posts = () => apiFetch.mock.calls.filter((c) => c[0] === "/api/orders");

describe("SaleOrderForm (/sales/orders/new)", () => {
  it("thiếu khách/sản phẩm/số lượng → báo lỗi, KHÔNG gọi POST", async () => {
    render(<SaleOrderForm today="2026-09-15" canEditPrice />);
    await userEvent.click(screen.getByRole("button", { name: "Lập đơn" }));
    await waitFor(() => expect(document.querySelectorAll('[aria-invalid="true"]').length).toBeGreaterThan(0));
    expect(posts()).toHaveLength(0);
  });

  it("có quyền sửa giá: gợi ý tồn + giá gần nhất, gửi POST kèm Idempotency-Key rồi mở đơn vừa lập", async () => {
    render(<SaleOrderForm today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await userEvent.click(screen.getAllByRole("tab", { name: "Dòng hàng" })[0]!); // form chia tab: dòng hàng ở tab riêng
    await pick("Sản phẩm dòng 1", "ton");
    expect(await screen.findByText(/Tồn: 10 md/)).toBeInTheDocument();
    expect(screen.getByText(/Giá gần nhất \(khách này\)/)).toBeInTheDocument();
    const price = screen.getByLabelText("Đơn giá dòng 1");
    await waitFor(() => expect(price).toHaveValue(30000)); // điền sẵn giá gần nhất
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Lập đơn" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sales/orders/5"));
    const [, init] = posts()[0]!;
    expect(init).toMatchObject({ method: "POST", json: { partnerId: 7, date: "2026-09-15", lines: [{ productId: 10, unit: "md", qty: 4, salePrice: 30000, discountNow: 0, discountAccum: 0, processingTypeId: null }] } });
    expect(init.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("thiếu quyền sửa giá: ô đơn giá chỉ đọc và luôn bằng giá gợi ý", async () => {
    render(<SaleOrderForm today="2026-09-15" canEditPrice={false} />);
    await pick("Khách hàng", "dat");
    await userEvent.click(screen.getAllByRole("tab", { name: "Dòng hàng" })[0]!); // form chia tab: dòng hàng ở tab riêng
    await pick("Sản phẩm dòng 1", "ton");
    const price = screen.getByLabelText("Đơn giá dòng 1");
    expect(price).toHaveAttribute("readonly");
    await waitFor(() => expect(price).toHaveValue(30000));
    expect(screen.getByText(/không có quyền sửa giá/)).toBeInTheDocument();
  });

  it("số lượng vượt tồn → cảnh báo đơn treo nhưng VẪN cho lập", async () => {
    render(<SaleOrderForm today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await userEvent.click(screen.getAllByRole("tab", { name: "Dòng hàng" })[0]!); // form chia tab: dòng hàng ở tab riêng
    await pick("Sản phẩm dòng 1", "ton");
    await screen.findByText(/Tồn: 10 md/);
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "25");
    expect(await screen.findByText(/Không đủ tồn — sẽ thành đơn treo/)).toBeInTheDocument();
  });

  it("không có quyền xem tồn/giá nhập (API không trả) → không hiện gợi ý tồn hay giá nhập", async () => {
    pricing = { productId: 10, baseUnit: "md", units: [{ unit: "md", factor: "1", suggestedPrice: null }], lastSalePrice: null, lastSalePriceForPartner: false };
    render(<SaleOrderForm today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await userEvent.click(screen.getAllByRole("tab", { name: "Dòng hàng" })[0]!); // form chia tab: dòng hàng ở tab riêng
    await pick("Sản phẩm dòng 1", "ton");
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => String(c[0]).startsWith("/api/orders/pricing"))).toBe(true));
    expect(screen.queryByText(/Tồn:/)).toBeNull();
    expect(screen.queryByText(/Giá nhập gần nhất/)).toBeNull();
  });
});

describe("SaleOrderForm — chế độ SỬA đơn", () => {
  const edit = {
    orderId: 5, code: "DH000005", customer: { value: 7, label: "KH000007 — Nguyễn Văn Đạt" }, products: [PRODUCT],
    defaults: {
      partnerId: 7, date: "2026-09-10", expectedDeliveryDate: "2026-09-20", note: "",
      lines: [{ id: 41, productId: 10, unit: "md", qty: 4, salePrice: 25_000, discountNow: 0, discountAccum: 0, processingTypeId: null }],
    },
  };

  it("nạp sẵn dữ liệu; lưu gửi PATCH /api/orders/5 kèm id dòng, không cần Idempotency-Key; rồi về chi tiết đơn", async () => {
    apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url.startsWith("/api/orders/pricing")) return pricing;
      if (url.startsWith("/api/orders/options/processing-types")) return [];
      if (url === "/api/orders/5" && init?.method === "PATCH") return { id: 5 };
      throw new Error(`unexpected ${url}`);
    });
    render(<SaleOrderForm today="2026-09-15" canEditPrice edit={edit} />);
    expect(screen.getByRole("heading", { name: /Sửa đơn DH000005/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Số lượng dòng 1")).toHaveValue(4);
    await userEvent.clear(screen.getByLabelText("Số lượng dòng 1"));
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "6");
    await userEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sales/orders/5"));
    const patch = apiFetch.mock.calls.find((c) => c[0] === "/api/orders/5")!;
    expect(patch[1]).toMatchObject({ method: "PATCH", json: { partnerId: 7, date: "2026-09-10", lines: [{ id: 41, productId: 10, qty: 6, salePrice: 25000 }] } });
    expect(patch[1].idempotencyKey).toBeUndefined();
  });

  it("thiếu quyền sửa giá: dòng cũ GIỮ giá 25.000 (không bị ép về giá gần nhất 30.000)", async () => {
    apiFetch.mockImplementation(async (url: string) => (url.startsWith("/api/orders/pricing") ? pricing : []));
    render(<SaleOrderForm today="2026-09-15" canEditPrice={false} edit={edit} />);
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => String(c[0]).startsWith("/api/orders/pricing"))).toBe(true));
    expect(screen.getByLabelText("Đơn giá dòng 1")).toHaveValue(25000);
  });
});
