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

it("editing an unchanged line displays its saved cost estimate instead of a newer configuration", async () => {
  pricing = { ...(pricing as object), costReference: { primary: { kind: "BOM", perBase: "99999", at: "2026-09-20", code: "Mới" }, alternatives: [] } };
  render(<SaleOrderForm today="2026-09-20" canEditPrice options={OPTS} edit={{
    orderId: 5, code: "DH000005", customer: { value: 7, label: "Khách A" }, products: [PRODUCT],
    referenceCosts: { 1: { productId: 10, processingTypeId: 3, issueMode: "BOM", reference: { primary: { kind: "BOM", perBase: "11111", at: "2026-09-19", code: "Đã lưu" }, alternatives: [] } } },
    defaults: { partnerId: 7, date: "2026-09-19", expectedDeliveryDate: "2026-09-20", note: "", lines: [{ id: 1, productId: 10, processingTypeId: 3, issueMode: "BOM", qty: 1, unit: "md", salePrice: 30000, discountNow: 0, discountAccum: 0 }] },
  }} />);
  await waitFor(() => expect(screen.getByText("11.111 ₫/md")).toBeInTheDocument());
  expect(screen.queryByText("99.999 ₫/md")).toBeNull();
});

it("accountant with only the cost hint sees one reference figure, no cost details, and a red warning below cost", async () => {
  pricing = { ...(pricing as object), costHint: { perBase: "40000" } };
  render(<SaleOrderForm today="2026-09-20" canEditPrice options={OPTS} edit={{
    orderId: 5, code: "DH000005", customer: { value: 7, label: "Khách A" }, products: [PRODUCT],
    defaults: { partnerId: 7, date: "2026-09-19", expectedDeliveryDate: "2026-09-20", note: "", lines: [{ id: 1, productId: 10, processingTypeId: 3, issueMode: "BOM", qty: 1, unit: "md", salePrice: 30000, discountNow: 0, discountAccum: 0 }] },
  }} />);
  await waitFor(() => expect(screen.getAllByText("40.000 ₫/md").length).toBeGreaterThan(0));
  expect(screen.getAllByText("Thấp hơn giá vốn tham khảo").length).toBeGreaterThan(0);
  expect(screen.queryByText("Chi tiết giá vốn")).toBeNull();
});

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
    await waitFor(() => expect(price).toHaveValue("30.000")); // điền sẵn giá gần nhất
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
    await waitFor(() => expect(price).toHaveValue("30.000"));
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
    await waitFor(() => expect(screen.getByLabelText("Đơn giá dòng 1")).toHaveValue("30.000"));
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
    expect(screen.getByLabelText("Số lượng dòng 1")).toHaveValue("4");
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
    expect(screen.getByLabelText("Đơn giá dòng 1")).toHaveValue("25.000");
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

  it("Lập đơn và in: lập đơn rồi mở mẫu HTML", async () => {
    const navigatePrint = vi.fn();
    const closePrint = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue({ location: { replace: navigatePrint }, closed: false, close: closePrint } as unknown as Window);
    apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (url.startsWith("/api/partner-lists/customers/search")) return [{ value: 7, label: "KH000007 — Nguyễn Văn Đạt" }];
      if (url.startsWith("/api/products/search")) return [PRODUCT];
      if (url.startsWith("/api/orders/pricing")) return pricing;
      if (url === "/api/orders" && init?.method === "POST") return { id: 5, code: "DH000005" };
      return [];
    });
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "4");
    await userEvent.click(screen.getByRole("button", { name: /In đơn hàng/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Lập đơn và in/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sales/orders/5"));
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(navigatePrint).toHaveBeenCalledWith("/api/print/SALE_INVOICE/5/html");
    expect(closePrint).not.toHaveBeenCalled();
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
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/Tên khách hàng/), "Anh Bảy");
    await userEvent.type(within(dialog).getByLabelText("Số điện thoại"), "0901234567");
    await userEvent.type(within(dialog).getByLabelText("Địa chỉ"), "123 Đường ABC");
    await userEvent.type(within(dialog).getByLabelText("Email"), "bay@example.com");
    await userEvent.type(within(dialog).getByLabelText("TK ngân hàng"), "0123456789 VCB");
    await userEvent.type(within(dialog).getByLabelText("Người đại diện"), "Bảy");
    await userEvent.type(within(dialog).getByLabelText("Thứ tự"), "3");
    await userEvent.type(within(dialog).getByLabelText("Công nợ đầu kỳ"), "-500000");
    await userEvent.type(within(dialog).getByLabelText("Hạn mức công nợ"), "20000000");
    await userEvent.click(within(dialog).getByLabelText("Chi phí"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Thêm mới" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Khách hàng" })).toHaveValue("KH000021 — Anh Bảy"));
    expect(screen.getByDisplayValue("0901234567")).toBeInTheDocument();
    expect(screen.getByDisplayValue("123 Đường ABC")).toBeInTheDocument();
    expect(screen.getByLabelText("Mã khách hàng")).toHaveValue("KH000021");
    const post = apiFetch.mock.calls.find((c) => c[0] === "/api/partners")![1];
    expect(post.json).toMatchObject({ name: "Anh Bảy", groupId: 3, isCustomer: true, isSupplier: false, isExpense: true, phone: "0901234567", address: "123 Đường ABC", email: "bay@example.com", bankAccount: "0123456789 VCB", representative: "Bảy", sortOrder: 3, openingDebt: -500000, debtLimit: 20000000, allowCredit: true });
  });

  it("dải nhập sản phẩm: chọn SP + đơn giá → Thêm vào đơn sinh đúng 1 dòng và hiện ảnh sản phẩm", async () => {
    apiFetch.mockImplementation(async (url: string) => (url.startsWith("/api/products/search") ? [{ ...PRODUCT, imageUrl: "https://img.example/tx01.png" }] : url.startsWith("/api/orders/pricing") ? pricing : []));
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Tên sản phẩm", "ton");
    expect(await screen.findByLabelText("Số lượng")).toHaveValue(""); // không còn gợi ý/mặc định 1
    await userEvent.type(screen.getByLabelText("Số lượng"), "1");
    await userEvent.type(await screen.findByLabelText("Đơn giá"), "30000");
    await userEvent.click(screen.getByRole("button", { name: /Thêm vào đơn/ }));
    await waitFor(() => expect(screen.getByLabelText("Số lượng dòng 1")).toHaveValue("1"));
    expect(screen.queryByLabelText("Số lượng dòng 2")).toBeNull();
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
    expect(await screen.findByDisplayValue("0312345678")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Kho 5")).toBeInTheDocument();
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "4"); // 4 × 30.000 = 120.000
    await userEvent.selectOptions(screen.getByLabelText("Hình thức thanh toán"), "CASH");
    expect(screen.getByLabelText(/Số tiền thu|Tiền cọc/)).toHaveValue(""); // khách thường: cọc để trống, không tự điền đủ
    await userEvent.click(screen.getByRole("button", { name: "Thu đủ" }));
    expect(screen.getByLabelText(/Số tiền thu|Tiền cọc/)).toHaveValue("120.000");
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

  it("khách lẻ (đơn thường): mặc định giao sau + thu hộ khi giao (lái xe thu), không tích tự chở; gửi checkout.walkIn không kèm pickupNow/thu tiền", async () => {
    baseApi((url, init) => (url === "/api/orders" && init?.method === "POST" ? { id: 8, code: "DH000008" } : undefined));
    render(<SaleOrderForm options={COUNTER} today="2026-09-15" canEditPrice />);
    await userEvent.click(screen.getByRole("button", { name: "Khách lẻ" }));
    expect(screen.getByLabelText(/Khách tự chở/)).not.toBeChecked();
    expect(screen.getByLabelText("Hình thức thanh toán")).toHaveValue("COD");
    await userEvent.type(screen.getByLabelText(/Tên khách/), "Anh Ba");
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Lập đơn" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sales/orders/8"));
    expect(posts()[0]![1].json).toMatchObject({ paymentMethod: "COD", checkout: { walkIn: { name: "Anh Ba", phone: "" } } });
    expect(posts()[0]![1].json.checkout.pickupNow).toBeUndefined();
    expect(posts()[0]![1].json.checkout.payments).toBeUndefined();
  });

  it("khách lẻ giao sau mà không có tên/SĐT → báo lỗi, KHÔNG gọi POST", async () => {
    baseApi(() => undefined);
    render(<SaleOrderForm options={COUNTER} today="2026-09-15" canEditPrice />);
    await userEvent.click(screen.getByRole("button", { name: "Khách lẻ" }));
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Lập đơn" }));
    expect(await screen.findByText(/nhập tên hoặc số điện thoại khách/)).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it("khách lẻ: ẩn tìm khách + Lưu nháp; tích tự chở ⇒ chuyển thu tiền mặt đủ, gửi checkout.walkIn + pickupNow", async () => {
    baseApi((url, init) => (url === "/api/orders" && init?.method === "POST" ? { id: 8, code: "DH000008" } : undefined));
    render(<SaleOrderForm options={COUNTER} today="2026-09-15" canEditPrice />);
    await userEvent.click(screen.getByRole("button", { name: "Khách lẻ" }));
    expect(screen.queryByRole("combobox", { name: "Khách hàng" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Lưu nháp/ })).toBeNull();
    await userEvent.click(screen.getByLabelText(/Khách tự chở/));
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

  it("khách lẻ tự chở thu thiếu → báo lỗi, KHÔNG gọi POST", async () => {
    baseApi(() => undefined);
    render(<SaleOrderForm options={COUNTER} today="2026-09-15" canEditPrice />);
    await userEvent.click(screen.getByRole("button", { name: "Khách lẻ" }));
    await userEvent.click(screen.getByLabelText(/Khách tự chở/));
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "2");
    await userEvent.clear(screen.getByLabelText(/Số tiền thu|Tiền cọc/));
    await userEvent.type(screen.getByLabelText(/Số tiền thu|Tiền cọc/), "10000");
    await userEvent.click(screen.getByRole("button", { name: "Lập đơn" }));
    expect(await screen.findByText(/lấy hàng tại quầy phải thanh toán đủ/)).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it("thu vượt tiền phải thu → báo lỗi, KHÔNG gọi POST; thiếu quyền thu tiền → không có khối thanh toán/khách lẻ", async () => {
    baseApi(() => undefined);
    const { unmount } = render(<SaleOrderForm options={COUNTER} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    await userEvent.type(screen.getByLabelText("Số lượng dòng 1"), "2");
    await userEvent.selectOptions(screen.getByLabelText("Hình thức thanh toán"), "CASH");
    await userEvent.clear(screen.getByLabelText(/Số tiền thu|Tiền cọc/));
    await userEvent.type(screen.getByLabelText(/Số tiền thu|Tiền cọc/), "999999");
    await userEvent.click(screen.getByRole("button", { name: "Lập đơn" }));
    expect(await screen.findByText(/vượt tiền phải thu/)).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    unmount();
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    expect(screen.queryByRole("button", { name: "Khách lẻ" })).toBeNull();
    expect(screen.queryByLabelText(/Số tiền thu|Tiền cọc/)).toBeNull();
    expect(screen.queryByLabelText(/Khách tự chở/)).toBeNull();
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
    expect(screen.getAllByText(/105\.000/).length).toBeGreaterThan(0); // 120.000 − 20.000 + 5.000
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
    await userEvent.click(screen.getByRole("button", { name: "Thu đủ" }));
    expect(screen.getByLabelText(/Số tiền thu|Tiền cọc/)).toHaveValue("63.000");
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
    apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => (url.startsWith("/api/orders/options/processing-types") ? [{ value: 4, label: "Tôn xốp,11 sóng", ratio: 1.08, priceBasis: "AREA" }] : base(url, init)));
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    await waitFor(() => expect(within(screen.getByLabelText("Kiểu gia công dòng 1")).getByRole("option", { name: "Tôn xốp,11 sóng" })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Kiểu gia công dòng 1"), "4");
    const m2 = await screen.findByLabelText("Đơn giá dòng 1");
    await userEvent.clear(m2); await userEvent.type(m2, "150000");
    await userEvent.type(screen.getByLabelText("Chiều dài dòng 1"), "7.1*7+6.8*1{Enter}");
    await waitFor(() => expect(screen.getByLabelText("Số lượng dòng 2")).toHaveValue("6,8"));
    expect(screen.getByLabelText("Số lượng dòng 1")).toHaveValue("49,7");
    expect(screen.getByLabelText("Đơn giá dòng 1")).toHaveValue("150.000");
    expect(screen.getByLabelText("Đơn giá dòng 2")).toHaveValue("150.000");
    // Dòng kích thước hiện ô sửa Dài / Số tấm / Giá m² ngay tại dòng (như màn bán hàng cũ)
    expect(screen.getByLabelText("Chiều dài (m) dòng 1")).toHaveValue("7,1");
    expect(screen.getByLabelText("Số tấm dòng 1")).toHaveValue("7");
    expect(screen.getByLabelText("Chiều dài (m) dòng 2")).toHaveValue("6,8");
    expect(screen.getByLabelText("Số tấm dòng 2")).toHaveValue("1");
    expect(screen.getAllByText(/= 53,676 m²/)).not.toHaveLength(0);
    expect(screen.getAllByText(/= 7,344 m²/)).not.toHaveLength(0);
  });

  it("sửa Số tấm / Dài ngay tại dòng kích thước: SL (md) và diện tích tự tính lại, giá/md giữ nguyên", async () => {
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => (url.startsWith("/api/orders/options/processing-types") ? [{ value: 4, label: "Tôn xốp,11 sóng", ratio: 1.08, priceBasis: "AREA" }] : base(url, init)));
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    await waitFor(() => expect(within(screen.getByLabelText("Kiểu gia công dòng 1")).getByRole("option", { name: "Tôn xốp,11 sóng" })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Kiểu gia công dòng 1"), "4");
    const m2 = await screen.findByLabelText("Đơn giá dòng 1");
    await userEvent.clear(m2); await userEvent.type(m2, "150000");
    await userEvent.type(screen.getByLabelText("Chiều dài dòng 1"), "7.1*7{Enter}");
    const pieces = await screen.findByLabelText("Số tấm dòng 1");
    await userEvent.clear(pieces); await userEvent.type(pieces, "8"); await userEvent.tab();
    await waitFor(() => expect(screen.getByLabelText("Số lượng dòng 1")).toHaveValue("56,8"));
    expect(screen.getByLabelText("Đơn giá dòng 1")).toHaveValue("150.000");
    expect(screen.getAllByText(/= 61,344 m²/)).not.toHaveLength(0);
    const len = screen.getByLabelText("Chiều dài (m) dòng 1");
    await userEvent.clear(len); await userEvent.type(len, "6,8"); await userEvent.tab();
    await waitFor(() => expect(screen.getByLabelText("Số lượng dòng 1")).toHaveValue("54,4"));
    expect(screen.getAllByText(/= 58,752 m²/)).not.toHaveLength(0);
  });

  it("kiểu gia công chưa có tỷ lệ: mặc định 1, lưu tỷ lệ người bán nhập khi tách dòng", async () => {
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => (url.startsWith("/api/orders/options/processing-types") ? [{ value: 4, label: "Tôn xốp,11 sóng", ratio: null, priceBasis: "AREA" }] : url === "/api/orders/processing-ratio" ? { ratio: "1.08", saved: true } : base(url, init)));
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Sản phẩm dòng 1", "ton");
    await waitFor(() => expect(within(screen.getByLabelText("Kiểu gia công dòng 1")).getByRole("option", { name: "Tôn xốp,11 sóng" })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Kiểu gia công dòng 1"), "4");
    expect(await screen.findByLabelText("Tỷ lệ m²/md dòng 1")).toHaveValue("1");
    await userEvent.type(screen.getByLabelText("Chiều dài dòng 1"), "5*2{Enter}");
    await waitFor(() => expect(screen.getByLabelText("Số lượng dòng 1")).toHaveValue("10"));
    expect(screen.getByLabelText("Chiều dài (m) dòng 1")).toHaveValue("5");
    expect(screen.getAllByText(/= 10 m²/)).not.toHaveLength(0);
    expect(apiFetch.mock.calls.some((c) => c[0] === "/api/orders/processing-ratio" && (c[1] as { json: { ratio: number } }).json.ratio === 1)).toBe(true);
  });

  it("dải nhập sản phẩm theo kích thước: chọn SP + kiểu + 7.1*7+6.8*1 + giá/m² → Thêm vào đơn sinh 2 dòng", async () => {
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => (url.startsWith("/api/orders/options/processing-types") ? [{ value: 4, label: "Tôn xốp,11 sóng", ratio: 1.08, priceBasis: "AREA" }] : base(url, init)));
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Tên sản phẩm", "ton");
    await waitFor(() => expect(within(screen.getByLabelText("Kiểu gia công")).getByRole("option", { name: "Tôn xốp,11 sóng" })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Kiểu gia công"), "4");
    await userEvent.type(screen.getByLabelText("Chiều dài"), "7.1*7+6.8*1");
    const price = await screen.findByLabelText("Đơn giá/m²");
    await userEvent.clear(price); await userEvent.type(price, "150000");
    await userEvent.click(screen.getByRole("button", { name: /Thêm vào đơn/ }));
    await waitFor(() => expect(screen.getByLabelText("Số lượng dòng 2")).toHaveValue("6,8"));
    expect(screen.getByLabelText("Số lượng dòng 1")).toHaveValue("49,7");
    expect(screen.getByLabelText("Đơn giá dòng 2")).toHaveValue("150.000");
    expect(screen.queryByLabelText("Số lượng dòng 3")).toBeNull();
  });

  it("dải nhập: kiểu tính giá theo mét vuông chỉ có ô Đơn giá/m²; kiểu mét dài chỉ có ô Đơn giá (md)", async () => {
    const base = apiFetch.getMockImplementation()!;
    let basis = "AREA";
    apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => (url.startsWith("/api/orders/options/processing-types") ? [{ value: 4, label: "Tôn xốp,11 sóng", ratio: 1.08, priceBasis: basis }] : base(url, init)));
    const { unmount } = render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Tên sản phẩm", "ton");
    await waitFor(() => expect(within(screen.getByLabelText("Kiểu gia công")).getByRole("option", { name: "Tôn xốp,11 sóng" })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Kiểu gia công"), "4");
    expect(await screen.findByLabelText("Đơn giá/m²")).toBeInTheDocument();
    expect(screen.queryByLabelText("Đơn giá")).toBeNull();
    unmount(); basis = "LENGTH";
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Tên sản phẩm", "ton");
    await waitFor(() => expect(within(screen.getByLabelText("Kiểu gia công")).getByRole("option", { name: "Tôn xốp,11 sóng" })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Kiểu gia công"), "4");
    expect(await screen.findByLabelText("Đơn giá")).toBeInTheDocument();
    expect(screen.queryByLabelText("Đơn giá/m²")).toBeNull();
  });

  it("kiểu bán theo ĐVT riêng (bình): đơn vị dòng tự chọn \"bình\", ẩn Chiều dài và ô m²", async () => {
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => (url.startsWith("/api/orders/options/processing-types") ? [{ value: 4, label: "Mủ vỏ", ratio: null, priceBasis: "UNIT", unit: "Bình" }] : base(url, init)));
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Khách hàng", "dat");
    await pick("Tên sản phẩm", "ton");
    await waitFor(() => expect(within(screen.getByLabelText("Kiểu gia công")).getByRole("option", { name: "Mủ vỏ" })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Kiểu gia công"), "4");
    expect(screen.queryByLabelText("Chiều dài")).toBeNull();
    expect(screen.queryByLabelText("Đơn giá/m²")).toBeNull();
    expect(await screen.findByLabelText("Đơn giá")).toBeInTheDocument();
  });

  it("kiểu gia công chưa có định mức: báo bán như hàng thường, vẫn nhập được", async () => {
    const base = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation(async (url: string, init?: { method?: string }) => (url.startsWith("/api/orders/options/processing-types") ? [{ value: 4, label: "Tôn xốp,11 sóng", ratio: null, hasBom: false, priceBasis: "AREA" }] : base(url, init)));
    render(<SaleOrderForm options={OPTS} today="2026-09-15" canEditPrice />);
    await pick("Sản phẩm dòng 1", "ton");
    await waitFor(() => expect(within(screen.getByLabelText("Kiểu gia công dòng 1")).getByRole("option", { name: "Tôn xốp,11 sóng" })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText("Kiểu gia công dòng 1"), "4");
    expect((await screen.findAllByText(/Chưa có định mức: bán như hàng thường/)).length).toBeGreaterThan(0);
  });
});
