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
const OPTS = { currentUserId: 1, salesUsers: [{ value: 1, label: "Nguyễn Văn A" }, { value: 2, label: "Trần B" }], warehouses: [{ value: 1, label: "Kho chính" }], groups: [{ value: 3, label: "Khách lẻ" }], canCreateCustomer: true, canPrint: true, cashAccounts: [] as { value: number; label: string; type: "CASH" | "BANK" }[], canCollect: false, canPickup: false, walkInPartnerId: null as number | null };
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
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await userEvent.click(screen.getByRole("button", { name: "Lập đơn" }));
    await waitFor(() => expect(document.querySelectorAll('[aria-invalid="true"]').length).toBeGreaterThan(0));
    expect(posts()).toHaveLength(0);
  });

  it("có quyền sửa giá: gợi ý tồn + giá gần nhất, gửi POST kèm Idempotency-Key rồi mở đơn vừa lập", async () => {
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
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
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice={false} />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    const price = screen.getByLabelText("Đơn giá dòng 1");
    expect(price).toHaveAttribute("readonly");
    await waitFor(() => expect(price).toHaveValue(30000));
    expect(screen.getByText(/không có quyền sửa giá/)).toBeInTheDocument();
  });

  it("số lượng vượt tồn → cảnh báo đơn treo nhưng VẪN cho lập", async () => {
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    await screen.findByText(/Tồn: 10 md/);
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "25");
    expect(await screen.findByText(/Không đủ tồn — sẽ thành đơn treo/)).toBeInTheDocument();
  });

  it("không có quyền xem tồn/giá nhập (API không trả) → không hiện gợi ý tồn hay giá nhập", async () => {
    pricing = { productId: 10, baseUnit: "md", units: [{ unit: "md", factor: "1", suggestedPrice: null }], lastSalePrice: null, lastSalePriceForPartner: false };
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => String(c[0]).startsWith("/api/orders/pricing"))).toBe(true));
    expect(screen.queryByText(/Tồn:/)).toBeNull();
    expect(screen.queryByText(/Giá nhập gần nhất/)).toBeNull();
  });
});

describe("SaleOrderForm — nhập nhanh", () => {
  it("chọn SP ở dòng cuối → tự mở dòng trống mới; dòng trống cuối bị bỏ khi lập đơn", async () => {
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    expect(await screen.findByLabelText("Số lượng dòng 2")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Lập đơn" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sales/orders/5"));
    expect(posts()[0]![1].json.lines).toHaveLength(1);
  });

  it("Enter ở ô SL của dòng cuối → mở dòng mới và focus ô tìm sản phẩm", async () => {
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "4{Enter}");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Sản phẩm dòng 2" })).toHaveFocus());
  });

  it("Chọn nhiều sản phẩm: tick trong dialog → điền vào dòng trống, ĐVT gốc, lấy giá gợi ý", async () => {
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await userEvent.click(screen.getByRole("button", { name: "Chọn nhiều sản phẩm" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByRole("checkbox", { name: /TX01/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Thêm 1 sản phẩm" }));
    expect(screen.getByRole("combobox", { name: "Sản phẩm dòng 1" })).toHaveValue("TX01 — Tôn xốp");
    expect(screen.getByLabelText("Đơn vị dòng 1")).toHaveValue("md");
    await waitFor(() => expect(screen.getByLabelText("Đơn giá dòng 1")).toHaveValue(30000));
  });

  it("bảng dòng hàng có lớp line-table + nhãn cột để hiện thẻ trên mobile", () => {
    const { container } = render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    expect(container.querySelector("table.line-table")).not.toBeNull();
    const labels = Array.from(container.querySelectorAll("tbody td[data-label]")).map((td) => td.getAttribute("data-label"));
    expect(labels).toEqual(expect.arrayContaining(["Sản phẩm", "ĐVT", "Số lượng", "Đơn giá", "Thành tiền"]));
  });

  it("chọn trùng SP + ĐVT → cảnh báo dòng đã có", async () => {
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Sản phẩm dòng 1", "ton");
    await pick("Sản phẩm dòng 2", "ton");
    expect(await screen.findByText(/đã có ở dòng 1/)).toBeInTheDocument();
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
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice edit={edit} />);
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
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice={false} edit={edit} />);
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => String(c[0]).startsWith("/api/orders/pricing"))).toBe(true));
    expect(screen.getByLabelText("Đơn giá dòng 1")).toHaveValue(25000);
  });
});

describe("SaleOrderForm — thông tin khác, lưu nháp, thêm khách, tìm nhanh", () => {
  it("gửi kèm nhân viên bán (mặc định người lập), kho đầu tiên, hình thức thanh toán đã chọn", async () => {
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    expect(screen.getByLabelText("Nhân viên bán")).toHaveValue("1");
    expect(screen.getByLabelText("Kho xuất")).toHaveValue("1");
    await userEvent.selectOptions(screen.getByLabelText("Hình thức thanh toán"), "TRANSFER");
    await userEvent.selectOptions(screen.getByLabelText("Nhân viên bán"), "2");
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Lập đơn" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sales/orders/5"));
    expect(posts()[0]![1]).toMatchObject({ json: { salesUserId: 2, warehouseId: 1, paymentMethod: "TRANSFER" } });
  });

  it("Lưu nháp → POST /api/orders/draft (không phải /api/orders) rồi mở đơn nháp", async () => {
    apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url.startsWith("/api/partner-lists/customers/search")) return [{ value: 7, label: "KH000007 — Nguyễn Văn Đạt" }];
      if (url.startsWith("/api/products/search")) return [PRODUCT];
      if (url.startsWith("/api/orders/pricing")) return pricing;
      if (url === "/api/orders/draft" && init?.method === "POST") return { id: 9, code: "DH000009" };
      return [];
    });
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "4");
    await userEvent.click(screen.getByRole("button", { name: /Lưu nháp/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sales/orders/9"));
    expect(posts()).toHaveLength(0);
    expect(apiFetch.mock.calls.find((c) => c[0] === "/api/orders/draft")![1].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("Lập đơn và in: lập đơn rồi gọi API in hóa đơn", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url.startsWith("/api/partner-lists/customers/search")) return [{ value: 7, label: "KH000007 — Nguyễn Văn Đạt" }];
      if (url.startsWith("/api/products/search")) return [PRODUCT];
      if (url.startsWith("/api/orders/pricing")) return pricing;
      if (url === "/api/orders" && init?.method === "POST") return { id: 5, code: "DH000005" };
      if (url === "/api/print/SALE_INVOICE/5") return { url: "https://docs.example/x", name: "x", replaced: false };
      return [];
    });
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "4");
    await userEvent.click(screen.getByRole("button", { name: /In đơn hàng/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Lập đơn và in/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sales/orders/5"));
    expect(open).toHaveBeenCalledWith("https://docs.example/x", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("không có quyền in / thêm khách → ẩn nút In và Thêm khách hàng", () => {
    render(<SaleOrderForm options={{ ...OPTS, canPrint: false, canCreateCustomer: false }} today="2026-09-15" canEditPrice />);
    expect(screen.queryByRole("button", { name: /In đơn hàng/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Thêm khách hàng/ })).toBeNull();
  });

  it("Thêm khách hàng nhanh → tạo qua /api/partners, chọn luôn khách và hiện SĐT/địa chỉ", async () => {
    apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url === "/api/partners" && init?.method === "POST") return { id: 21, code: "KH000021" };
      return [];
    });
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await userEvent.click(screen.getByRole("button", { name: /Thêm khách hàng/ }));
    await userEvent.type(await screen.findByLabelText(/Tên khách hàng/), "Anh Bảy");
    await userEvent.type(screen.getByLabelText("Số điện thoại"), "0901234567");
    await userEvent.type(screen.getByLabelText("Địa chỉ"), "123 Đường ABC");
    await userEvent.click(screen.getByRole("button", { name: "Thêm" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Khách hàng" })).toHaveValue("KH000021 — Anh Bảy"));
    expect(screen.getByText("0901234567")).toBeInTheDocument();
    expect(screen.getByText("123 Đường ABC")).toBeInTheDocument();
    const post = apiFetch.mock.calls.find((c) => c[0] === "/api/partners")![1];
    expect(post.json).toMatchObject({ name: "Anh Bảy", groupId: 3, isCustomer: true, isSupplier: false, phone: "0901234567", address: "123 Đường ABC" });
  });

  it("ô tìm sản phẩm nhanh thêm đúng 1 dòng và hiện ảnh sản phẩm", async () => {
    apiFetch.mockImplementation(async (url: string) => (url.startsWith("/api/products/search") ? [{ ...PRODUCT, imageUrl: "https://img.example/tx01.png" }] : url.startsWith("/api/orders/pricing") ? pricing : []));
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Tìm sản phẩm nhanh", "ton");
    await waitFor(() => expect(screen.getByLabelText("Số lượng dòng 1")).toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "Sản phẩm dòng 1" })).toHaveValue("TX01 — Tôn xốp");
    expect(document.querySelector('img[src="https://img.example/tx01.png"]')).not.toBeNull();
  });
});

describe("SaleOrderForm — bán tại quầy (khách lẻ, thu tiền, giao ngay)", () => {
  const COUNTER = { ...OPTS, canCollect: true, canPickup: true, cashAccounts: [{ value: 5, label: "Quỹ tiền mặt", type: "CASH" as const }, { value: 6, label: "Vietcombank", type: "BANK" as const }] };
  const baseApi = (extra: (url: string, init?: { method?: string }) => unknown) => apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
    const r = extra(url, init);
    if (r !== undefined) return r;
    if (url.startsWith("/api/partner-lists/customers/search")) return [{ value: 7, label: "KH000007 — Nguyễn Văn Đạt", hint: "0901", address: "123 ABC", taxCode: "0312345678", deliveryAddress: "Kho 5" }];
    if (url.startsWith("/api/products/search")) return [PRODUCT];
    if (url.startsWith("/api/orders/pricing")) return pricing;
    return [];
  });

  it("đối tác: hiện MST + địa chỉ giao hàng; thu tiền mặt đủ + giao ngay → gửi checkout kèm tài khoản quỹ", async () => {
    baseApi((url, init) => (url === "/api/orders" && init?.method === "POST" ? { id: 5, code: "DH000005" } : undefined));
    render(<SaleOrderForm options={COUNTER} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    expect(await screen.findByText("0312345678")).toBeInTheDocument();
    expect(screen.getByText("Kho 5")).toBeInTheDocument();
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "4"); // 4 × 30.000 = 120.000
    await userEvent.selectOptions(screen.getByLabelText("Hình thức thanh toán"), "CASH");
    expect(screen.getByLabelText("Số tiền thu")).toHaveValue(120000); // thu đủ mặc định
    expect(screen.getByLabelText("Quỹ tiền mặt")).toHaveValue("5");
    await userEvent.click(screen.getByLabelText(/Khách tự chở/));
    await userEvent.click(screen.getByRole("button", { name: "Lập đơn" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sales/orders/5"));
    expect(posts()[0]![1].json).toMatchObject({ partnerId: 7, paymentMethod: "CASH", checkout: { pickupNow: true, payments: [{ amount: 120000, cashAccountId: 5, note: "" }] } });
    expect(posts()[0]![1].json.checkout.walkIn).toBeUndefined();
  });

  it("chuyển khoản → chỉ liệt kê tài khoản ngân hàng", async () => {
    baseApi(() => undefined);
    render(<SaleOrderForm options={COUNTER} today="2026-09-15" canEditPrice />);
    await userEvent.selectOptions(screen.getByLabelText("Hình thức thanh toán"), "TRANSFER");
    const sel = screen.getByLabelText("Ngân hàng");
    expect(within(sel).getAllByRole("option").map((o) => o.textContent)).toEqual(["— Chọn —", "Vietcombank"].slice(0, 1).concat(["Vietcombank"]));
    expect(sel).toHaveValue("6");
  });

  it("khách lẻ: ẩn tìm khách + Lưu nháp, tự bật giao ngay + thu tiền mặt đủ, gửi checkout.walkIn", async () => {
    baseApi((url, init) => (url === "/api/orders" && init?.method === "POST" ? { id: 8, code: "DH000008" } : undefined));
    render(<SaleOrderForm options={COUNTER} today="2026-09-15" canEditPrice />);
    await userEvent.click(screen.getByRole("button", { name: "Khách lẻ" }));
    expect(screen.queryByRole("combobox", { name: "Khách hàng" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Lưu nháp/ })).toBeNull();
    expect(screen.getByLabelText(/Khách tự chở/)).toBeChecked();
    expect(screen.getByLabelText("Hình thức thanh toán")).toHaveValue("CASH");
    await userEvent.type(screen.getByLabelText(/Tên khách/), "Anh Ba");
    await userEvent.type(screen.getByLabelText(/Số điện thoại/), "0909");
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "2"); // 60.000
    await userEvent.click(screen.getByRole("button", { name: "Lập đơn" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sales/orders/8"));
    expect(posts()[0]![1].json.checkout).toMatchObject({ walkIn: { name: "Anh Ba", phone: "0909" }, pickupNow: true, payments: [{ amount: 60000, cashAccountId: 5 }] });
  });

  it("khách lẻ thu thiếu → báo lỗi, KHÔNG gọi POST", async () => {
    baseApi(() => undefined);
    render(<SaleOrderForm options={COUNTER} today="2026-09-15" canEditPrice />);
    await userEvent.click(screen.getByRole("button", { name: "Khách lẻ" }));
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "2");
    await userEvent.clear(screen.getByLabelText("Số tiền thu"));
    await userEvent.type(screen.getByLabelText("Số tiền thu"), "10000");
    await userEvent.click(screen.getByRole("button", { name: "Lập đơn" }));
    expect(await screen.findByText(/Khách lẻ phải thanh toán đủ/)).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it("thu vượt tiền phải thu → báo lỗi, KHÔNG gọi POST; thiếu quyền thu tiền → không có khối thanh toán/khách lẻ", async () => {
    baseApi(() => undefined);
    const { unmount } = render(<SaleOrderForm options={COUNTER} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "2");
    await userEvent.selectOptions(screen.getByLabelText("Hình thức thanh toán"), "CASH");
    await userEvent.clear(screen.getByLabelText("Số tiền thu"));
    await userEvent.type(screen.getByLabelText("Số tiền thu"), "999999");
    await userEvent.click(screen.getByRole("button", { name: "Lập đơn" }));
    expect(await screen.findByText(/vượt tiền phải thu/)).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    unmount();
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    expect(screen.queryByRole("button", { name: "Khách lẻ" })).toBeNull();
    expect(screen.queryByText("Thông tin thanh toán")).toBeNull();
  });
});

describe("SaleOrderForm — phí vận chuyển, chiết khấu cả đơn, ghi chú dòng, chế độ bán lẻ", () => {
  const COUNTER = { ...OPTS, canCollect: true, canPickup: true, cashAccounts: [{ value: 5, label: "Quỹ tiền mặt", type: "CASH" as const }] };
  const api = (post?: { url: string; res: unknown }) => apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (post && url === post.url && init?.method === "POST") return post.res;
    if (url.startsWith("/api/partner-lists/customers/search")) return [{ value: 7, label: "KH000007 — Nguyễn Văn Đạt" }];
    if (url.startsWith("/api/products/search")) return [PRODUCT];
    if (url.startsWith("/api/orders/pricing")) return pricing;
    return [];
  });

  it("tiền phải thu = hàng − chiết khấu cả đơn + phí vận chuyển; gửi kèm ghi chú dòng", async () => {
    api({ url: "/api/orders", res: { id: 5, code: "DH000005" } });
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "4"); // 120.000
    await userEvent.type(screen.getByLabelText("Ghi chú dòng 1"), "Cắt 2m");
    await userEvent.clear(screen.getByLabelText("Chiết khấu cả đơn"));
    await userEvent.type(screen.getByLabelText("Chiết khấu cả đơn"), "20000");
    await userEvent.clear(screen.getByLabelText("Phí vận chuyển"));
    await userEvent.type(screen.getByLabelText("Phí vận chuyển"), "5000");
    expect(screen.getByText(/105\.000/)).toBeInTheDocument(); // 120.000 − 20.000 + 5.000
    await userEvent.click(screen.getByRole("button", { name: "Lập đơn" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sales/orders/5"));
    expect(posts()[0]![1].json).toMatchObject({ orderDiscount: 20000, shippingFee: 5000, lines: [{ note: "Cắt 2m", qty: 4 }] });
  });

  it("xoá trống ô phí/chiết khấu → coi là 0 (không báo lỗi)", async () => {
    api({ url: "/api/orders", res: { id: 5, code: "DH000005" } });
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "1");
    await userEvent.clear(screen.getByLabelText("Phí vận chuyển"));
    await userEvent.click(screen.getByRole("button", { name: "Lập đơn" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sales/orders/5"));
    expect(posts()[0]![1].json).toMatchObject({ shippingFee: 0, orderDiscount: 0 });
  });

  it("thu tiền: số phải thu gồm cả phí vận chuyển (Thu đủ = hàng + phí)", async () => {
    api();
    render(<SaleOrderForm options={COUNTER} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "2"); // 60.000
    await userEvent.clear(screen.getByLabelText("Phí vận chuyển"));
    await userEvent.type(screen.getByLabelText("Phí vận chuyển"), "3000");
    await userEvent.selectOptions(screen.getByLabelText("Hình thức thanh toán"), "CASH");
    expect(screen.getByLabelText("Số tiền thu")).toHaveValue(63000);
  });

  it("chế độ bán lẻ: tiêu đề + khách lẻ + giao ngay + thu tiền mặt sẵn, ẩn ngày giao/Thông tin khác, có link về Đơn thường", async () => {
    api({ url: "/api/orders", res: { id: 9, code: "DH000009" } });
    render(<SaleOrderForm options={COUNTER} today="2026-09-15" canEditPrice retail />);
    expect(screen.getByRole("heading", { name: "Bán lẻ tại quầy" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Ngày giao dự kiến/)).toBeNull();
    expect(screen.queryByText("Thông tin khác")).toBeNull();
    expect(screen.getByLabelText(/Khách tự chở/)).toBeChecked();
    expect(screen.getByLabelText("Hình thức thanh toán")).toHaveValue("CASH");
    expect(screen.getByRole("link", { name: /Đơn thường/ })).toHaveAttribute("href", "/sales/orders/new");
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "2"); // 60.000
    await userEvent.click(screen.getByRole("button", { name: "Thu tiền & lập đơn" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sales/orders/9"));
    expect(posts()[0]![1].json.checkout).toMatchObject({ walkIn: { name: "", phone: "" }, pickupNow: true, payments: [{ amount: 60000, cashAccountId: 5 }] });
  });

  it("chế độ thường có link sang Bán lẻ tại quầy (khi có quyền thu tiền); thiếu quyền thì không có", () => {
    api();
    const { unmount } = render(<SaleOrderForm options={COUNTER} today="2026-09-15" canEditPrice />);
    expect(screen.getByRole("link", { name: /Bán lẻ tại quầy/ })).toHaveAttribute("href", "/sales/orders/new?mode=retail");
    unmount();
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    expect(screen.queryByRole("link", { name: /Bán lẻ tại quầy/ })).toBeNull();
  });
});

describe("SaleOrderForm — bảng dòng hàng dạng lưới", () => {
  it("mỗi dòng có đúng số ô như số cột tiêu đề (không lệch cột), có STT và colgroup độ rộng cố định", async () => {
    apiFetch.mockImplementation(async () => []);
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    const table = document.querySelector("table.line-table") as HTMLTableElement;
    const headers = table.querySelectorAll("thead th");
    expect(headers).toHaveLength(11);
    expect(Array.from(headers).map((h) => h.textContent?.replace(/\s*\*$/, "").trim()).slice(0, 3)).toEqual(["STT", "Sản phẩm", "ĐVT"]);
    expect(table.querySelectorAll("colgroup col")).toHaveLength(11);
    const rows = table.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => expect(r.querySelectorAll(":scope > td")).toHaveLength(headers.length));
    expect(rows[0]!.querySelector("td")!.textContent).toBe("1");
  });

  it("thêm dòng: STT tăng dần, vẫn khớp số cột", async () => {
    apiFetch.mockImplementation(async () => []);
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await userEvent.click(screen.getByRole("button", { name: /Thêm dòng/ }));
    const rows = document.querySelectorAll("table.line-table tbody tr");
    expect(rows).toHaveLength(2);
    expect(Array.from(rows).map((r) => r.querySelector("td")!.textContent)).toEqual(["1", "2"]);
    rows.forEach((r) => expect(r.querySelectorAll(":scope > td")).toHaveLength(11));
  });
});

describe("SaleOrderForm — nhóm hàng trên dòng", () => {
  it("hiện 'Nhóm: … | Tồn: …' dưới ô sản phẩm; chưa có nhóm thì chỉ hiện Tồn", async () => {
    apiFetch.mockImplementation(async (url: string) => (url.startsWith("/api/products/search") ? [{ ...PRODUCT, groupName: "Tấm alu" }] : url.startsWith("/api/orders/pricing") ? pricing : url.startsWith("/api/partner-lists") ? [{ value: 7, label: "KH000007 — Nguyễn Văn Đạt" }] : []));
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    expect(await screen.findByText(/Nhóm: Tấm alu/)).toHaveTextContent(/Nhóm: Tấm alus*|s*Tồn: 10 md/);
  });

  it("bán tôn theo kích thước: nhập 7.1*7+6.8*1 → tách 2 dòng cùng SP/kiểu gia công, SL = dài × số tấm, giá/md = giá/m² × tỷ lệ", async () => {
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => (url.startsWith("/api/orders/options/processing-types") ? [{ value: 4, label: "Tôn xốp,11 sóng", ratio: 1.08 }] : base(url, init)));
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    await waitFor(() => expect(within(screen.getByLabelText("Kiểu gia công dòng 1")).getByRole("option", { name: "Tôn xốp,11 sóng" })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Kiểu gia công dòng 1"), "4");
    const m2 = await screen.findByLabelText("Đơn giá theo m² dòng 1");
    await userEvent.clear(m2); await userEvent.type(m2, "150000");
    await userEvent.type(screen.getByLabelText("Chiều dài dòng 1"), "7.1*7+6.8*1{Enter}");
    await waitFor(() => expect(screen.getByLabelText("Số lượng dòng 2")).toHaveValue(6.8));
    expect(screen.getByLabelText("Số lượng dòng 1")).toHaveValue(49.7);
    expect(screen.getByLabelText("Đơn giá dòng 1")).toHaveValue(162000);
    expect(screen.getByLabelText("Đơn giá dòng 2")).toHaveValue(162000);
    expect(screen.getByLabelText("Ghi chú dòng 1")).toHaveValue("7,1 m × 1,08 × 7 = 53,676 m²");
    expect(screen.getByLabelText("Ghi chú dòng 2")).toHaveValue("6,8 m × 1,08 × 1 = 7,344 m²");
  });
});
