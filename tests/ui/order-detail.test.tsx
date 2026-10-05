// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderDetail } from "@/components/sales/OrderDetail";
import type { OrderDetailDTO } from "@/server/sales/queries";

const refresh = vi.fn();
const apiFetch = vi.fn();
const confirmFn = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  usePathname: () => "/sales/orders/1",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));
vi.mock("@/lib/confirm-store", () => ({ confirm: (...a: unknown[]) => confirmFn(...a) }));

beforeEach(() => { refresh.mockReset(); apiFetch.mockReset(); confirmFn.mockReset(); search = ""; });
afterEach(cleanup);

const order = (over: Partial<OrderDetailDTO> = {}): OrderDetailDTO => ({
  id: 1, code: "DH000001", orderDate: new Date("2026-09-10T03:00:00Z"), partnerId: 1, partnerCode: "KH000001", partnerName: "Nguyễn Văn Đạt",
  deliveryStatus: "PARTIAL", paymentStatus: "UNPAID", expectedDeliveryDate: "2026-09-20", originalDeliveryDate: "2026-09-20", delayDays: 0,
  hasProvisional: false, isCancelled: false, isDraft: false, deposits: [], depositTotal: "0", quote: null, note: null, cancelReason: null, createdByName: "An", walkInName: null, walkInPhone: null, salesUserName: null, warehouseName: null, paymentMethod: "NONE", orderTotal: "300000", history: [],
  lines: [{
    id: 11, productId: 5, productCode: "TX01", productName: "Tôn xốp", baseUnit: "md", qty: "10", unit: "md", qtyBase: "10", processingType: null, bomVersionId: null, bomVersionLabel: null,
    isProvisional: false, deliveredQty: "4", salePrice: "30000", discountNow: "0", discountAccum: "0", lineAmount: "300000", issues: [],
  }],
  deliveries: [{ id: 9, code: "PG000009", at: new Date("2026-09-12T03:00:00Z"), isCancelled: false, note: null, lines: [{ orderLineId: 11, productName: "Tôn xốp", unit: "md", qty: "4" }] }],
  ...over,
});
const ALL = { canEdit: true, canCancel: true, canRestore: true, canConfirm: true, canDeleteDraft: true, canDeposit: true, canReturn: true };
const view = (o = order(), perms = ALL) => render(<OrderDetail order={o} perms={perms} today="2026-09-15" />);

describe("OrderDetail — hành động theo quyền", () => {
  it("có quyền: Sửa đơn (link) + Hủy đơn; đơn hoạt động không có Khôi phục", () => {
    view();
    expect(screen.getByRole("link", { name: "Sửa đơn" })).toHaveAttribute("href", "/sales/orders/1/edit");
    expect(screen.getByRole("button", { name: "Hủy đơn" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Khôi phục/ })).toBeNull();
  });

  it("chỉ xem: không có nút nào", () => {
    view(order(), { canEdit: false, canCancel: false, canRestore: false, canConfirm: false, canDeleteDraft: false, canDeposit: false, canReturn: false });
    expect(screen.queryByRole("link", { name: "Sửa đơn" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hủy đơn" })).toBeNull();
  });

  it("đơn đã hủy: banner lý do + Khôi phục, không Sửa/Hủy, không form lập phiếu giao", () => {
    search = "tab=delivery";
    view(order({ isCancelled: true, cancelReason: "Khách đổi ý" }));
    expect(screen.getByRole("status")).toHaveTextContent("Lý do: Khách đổi ý");
    expect(screen.getAllByText("Đã hủy").length).toBeGreaterThan(0); // nhãn trạng thái không còn "Sẵn hàng"
    expect(screen.queryByText("Sẵn hàng")).toBeNull();
    expect(screen.getByRole("button", { name: "Khôi phục đơn DH000001" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sửa đơn" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Lập phiếu giao" })).toBeNull();
  });

  it("hủy đơn bắt buộc nhập lý do rồi POST /api/orders/1/cancel", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true });
    view();
    await userEvent.click(screen.getByRole("button", { name: "Hủy đơn" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Hủy đơn" }));
    expect(await within(dialog).findByText("Nhập lý do.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText("Lý do"), "Khách đổi ý");
    await userEvent.click(within(dialog).getByRole("button", { name: "Hủy đơn" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/orders/1/cancel", { method: "POST", json: { reason: "Khách đổi ý" } }));
    expect(refresh).toHaveBeenCalled();
  });
});

describe("DeliveryPanel (tab Giao hàng)", () => {
  beforeEach(() => { search = "tab=delivery"; });

  it("hiện phần còn phải giao; nút 'Hết' điền đủ; gửi POST kèm Idempotency-Key", async () => {
    apiFetch.mockResolvedValueOnce({ id: 10, code: "PG000010" });
    view();
    expect(screen.getByText(/6 md/)).toBeInTheDocument(); // 10 − 4
    await userEvent.click(screen.getByRole("button", { name: "Giao hết Tôn xốp" }));
    expect(screen.getByLabelText("Số lượng giao Tôn xốp")).toHaveValue(6);
    await userEvent.click(screen.getByRole("button", { name: "Lập phiếu giao" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [url, init] = apiFetch.mock.calls[0]!;
    expect(url).toBe("/api/delivery-notes");
    expect(init).toMatchObject({ method: "POST", json: { orderId: 1, date: "2026-09-15", lines: [{ orderLineId: 11, qty: 6 }] } });
    expect(init.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("không nhập số lượng nào → báo lỗi, không gọi API; lỗi từ server hiển thị và giữ dữ liệu nhập", async () => {
    view();
    await userEvent.click(screen.getByRole("button", { name: "Lập phiếu giao" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nhập số lượng giao");
    expect(apiFetch).not.toHaveBeenCalled();
    apiFetch.mockRejectedValueOnce(new Error("Dòng 1: chỉ còn 6 md chưa giao."));
    await userEvent.type(screen.getByLabelText("Số lượng giao Tôn xốp"), "9");
    await userEvent.click(screen.getByRole("button", { name: "Lập phiếu giao" }));
    expect(await screen.findByText("Dòng 1: chỉ còn 6 md chưa giao.")).toBeInTheDocument();
    expect(screen.getByLabelText("Số lượng giao Tôn xốp")).toHaveValue(9);
  });

  it("hủy phiếu giao cần xác nhận rồi POST; từ chối thì không gọi", async () => {
    view();
    confirmFn.mockResolvedValueOnce(false);
    await userEvent.click(screen.getByRole("button", { name: "Hủy phiếu giao PG000009" }));
    expect(apiFetch).not.toHaveBeenCalled();
    confirmFn.mockResolvedValueOnce(true);
    apiFetch.mockResolvedValueOnce({ ok: true });
    await userEvent.click(screen.getByRole("button", { name: "Hủy phiếu giao PG000009" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/delivery-notes/9/cancel", { method: "POST" }));
  });

  it("đã giao đủ ⇒ không còn form lập phiếu; chỉ xem không có nút hủy phiếu", () => {
    const full = order();
    full.lines[0]!.deliveredQty = "10";
    view(full, { canEdit: false, canCancel: false, canRestore: false, canConfirm: false, canDeleteDraft: false, canDeposit: false, canReturn: false });
    expect(screen.queryByRole("region", { name: "Lập phiếu giao" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Hủy phiếu giao/ })).toBeNull();
    expect(screen.getByText("PG000009")).toBeInTheDocument();
  });
});

describe("OrderDetail — NVL đã trừ khi bán tôn xốp (mã 15)", () => {
  const bomLine = (cost: boolean) => ({
    ...order().lines[0]!, processingType: "Tôn xốp 3 lớp", bomVersionId: 3, bomVersionLabel: "Định mức v2 · từ 01/10/2026", isProvisional: true,
    issues: [
      { productCode: "TC01", productName: "Tôn cuộn", baseUnit: "kg", qtyBase: "12", qtyProvisional: "0", ...(cost ? { materialCost: "120000" } : {}) },
      { productCode: "PU01", productName: "Foam PU", baseUnit: "lít", qtyBase: "5", qtyProvisional: "2", ...(cost ? { materialCost: "10000" } : {}) },
    ],
  });
  it("hiện phiên bản định mức, từng NVL, phần thiếu tồn và vốn (khi có cost.view)", () => {
    search = "tab=lines";
    view(order({ lines: [bomLine(true)] }));
    const list = screen.getByRole("list", { name: /Nguyên vật liệu đã trừ/ });
    expect(screen.getByText("Định mức v2 · từ 01/10/2026")).toBeInTheDocument();
    expect(within(list).getByText(/Trừ 12 kg Tôn cuộn/)).toHaveTextContent("vốn");
    expect(within(list).getByText(/Trừ 5 lít Foam PU/)).toHaveTextContent("thiếu tồn 2");
  });
  it("không có vốn NVL khi thiếu cost.view", () => {
    search = "tab=lines";
    view(order({ lines: [bomLine(false)] }));
    expect(within(screen.getByRole("list", { name: /Nguyên vật liệu đã trừ/ })).queryByText(/vốn/)).toBeNull();
  });
});

describe("OrderDetail — trả hàng", () => {
  it("đơn đã giao một phần + có quyền: link Trả hàng tới màn 43; không quyền / đơn chưa giao: ẩn", () => {
    view();
    expect(screen.getByRole("link", { name: "Trả hàng" })).toHaveAttribute("href", "/returns/by-order/new?orderId=1");
    cleanup();
    view(order(), { ...ALL, canReturn: false });
    expect(screen.queryByRole("link", { name: "Trả hàng" })).toBeNull();
    cleanup();
    view(order({ deliveryStatus: "NEW" }));
    expect(screen.queryByRole("link", { name: "Trả hàng" })).toBeNull();
  });
});

describe("OrderDetail — đơn nháp & tiền cọc", () => {
  it("đơn nháp: banner + Xác nhận / Sửa nháp / Xóa nháp, không có Hủy đơn; Xác nhận gọi API sau confirm", async () => {
    confirmFn.mockResolvedValue(true);
    view(order({ isDraft: true, deliveryStatus: "NEW", deliveries: [] }));
    expect(screen.getByRole("status")).toHaveTextContent("NHÁP");
    expect(screen.getByRole("link", { name: "Sửa nháp" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hủy đơn" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Xác nhận đơn" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/orders/1/confirm", { method: "POST" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("Xóa nháp: hỏi xác nhận rồi DELETE; từ chối thì không gọi API", async () => {
    confirmFn.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    view(order({ isDraft: true, deliveries: [] }));
    await userEvent.click(screen.getByRole("button", { name: "Xóa nháp" }));
    expect(apiFetch).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Xóa nháp" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/orders/1", { method: "DELETE" }));
  });

  it("không có quyền xác nhận/xóa nháp: hai nút ẩn", () => {
    view(order({ isDraft: true, deliveries: [] }), { ...ALL, canConfirm: false, canDeleteDraft: false });
    expect(screen.queryByRole("button", { name: "Xác nhận đơn" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Xóa nháp" })).toBeNull();
  });

  it("tab Tiền cọc: liệt kê phiếu + tổng, có nút chuyển thành số dư / hủy phiếu", () => {
    search = "tab=deposits";
    apiFetch.mockResolvedValue([{ id: 1, name: "Tiền mặt" }]);
    view(order({ deposits: [{ id: 7, code: "PT000007", at: new Date("2026-09-11T03:00:00Z"), amount: "80000", cashAccountName: "Tiền mặt", note: null }], depositTotal: "80000" }));
    expect(screen.getByText("PT000007")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chuyển cọc PT000007 thành số dư" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hủy phiếu cọc PT000007" })).toBeInTheDocument();
  });
});
