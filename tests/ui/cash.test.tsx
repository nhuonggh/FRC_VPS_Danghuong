// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CashBook } from "@/components/cash/CashBook";
import { ReviewQueue } from "@/components/cash/ReviewQueue";
import { VoucherDetail } from "@/components/cash/VoucherDetail";
import { VoucherForm } from "@/components/cash/VoucherForm";
import type { CashBookDTO, QueueRowDTO, VoucherDetailDTO } from "@/server/cash/queries";

const refresh = vi.fn(); const replace = vi.fn(); const apiFetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace, refresh }), usePathname: () => "/accounting/receipts", useSearchParams: () => new URLSearchParams("") }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));
beforeEach(() => {
  refresh.mockReset(); replace.mockReset(); apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string) => (url.startsWith("/api/cash/partners") ? [{ value: 7, label: "KH000007 — Nguyễn Văn Đạt" }] : url.startsWith("/api/cash/orders") ? [{ value: 31, label: "DH000031", hint: "2026-09-10" }] : { id: 5 }));
});
afterEach(cleanup);
const accounts = [{ id: 1, name: "Tiền mặt", type: "CASH" as const }, { id: 2, name: "VCB", type: "BANK" as const }];

async function pick(name: string, text: string) {
  const box = screen.getByRole("combobox", { name }); await userEvent.click(box); await userEvent.type(box, text);
  await userEvent.click((await within(await screen.findByRole("listbox")).findAllByRole("option"))[0]!);
}

describe("VoucherForm", () => {
  it("phiếu thu: thiếu khách/số tiền ⇒ báo lỗi, không gọi API; đủ ⇒ POST kèm khoá idempotency và chuyển tới chi tiết", async () => {
    render(<VoucherForm doc="RECEIPT" today="2026-09-15" accounts={accounts} />);
    await userEvent.click(screen.getByRole("button", { name: "Lưu phiếu" }));
    expect(await screen.findByText("Chọn khách hàng.")).toBeInTheDocument();
    expect(apiFetch.mock.calls.some((c) => c[0] === "/api/vouchers/receipts")).toBe(false);
    await pick("Khách hàng", "dat");
    await waitFor(() => expect(screen.getByRole("option", { name: /DH000031/ })).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/Thu theo đơn/), "31");
    await userEvent.type(screen.getByLabelText(/Số tiền/), "250000");
    await userEvent.click(screen.getByRole("button", { name: "Lưu phiếu" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/accounting/receipts/5"));
    const [, init] = apiFetch.mock.calls.find((c) => c[0] === "/api/vouchers/receipts")!;
    expect(init.json).toMatchObject({ type: "THU_NO", partnerId: 7, orderId: 31, cashAccountId: 1, amount: 250000, date: "2026-09-15" });
    expect(init.idempotencyKey).toBeTruthy();
  });
  it("phiếu chi: chi khác không có ô đối tác; trả NCC gọi tìm nhà cung cấp", async () => {
    render(<VoucherForm doc="PAYMENT" today="2026-09-15" accounts={accounts} />);
    expect(screen.getByRole("combobox", { name: "Nhà cung cấp" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/Loại phiếu chi/), "KHAC");
    expect(screen.queryByRole("combobox", { name: "Nhà cung cấp" })).not.toBeInTheDocument(); expect(screen.queryByRole("combobox", { name: "Khách hàng" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Số tiền/), "50000");
    await userEvent.click(screen.getByRole("button", { name: "Lưu phiếu" }));
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => c[0] === "/api/vouchers/payments")).toBe(true));
    expect(apiFetch.mock.calls.find((c) => c[0] === "/api/vouchers/payments")![1].json).toMatchObject({ kind: "KHAC", partnerId: null, amount: 50000 });
  });
  it("sửa phiếu: PATCH, không đổi được loại", async () => {
    render(<VoucherForm doc="RECEIPT" id={9} code="PT000009" today="2026-09-15" accounts={accounts} initial={{ type: "THU_NO", partner: { value: 7, label: "KH000007 — Đạt" }, order: null, cashAccountId: 2, amount: "100000", date: "2026-09-14", note: "" }} />);
    expect(screen.getByLabelText(/Loại phiếu thu/)).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(true));
    expect(apiFetch.mock.calls.find((c) => c[1]?.method === "PATCH")![0]).toBe("/api/vouchers/receipts/9");
  });
});

const detail = (over: Partial<VoucherDetailDTO> = {}): VoucherDetailDTO => ({
  id: 9, doc: "RECEIPT", code: "PT000009", at: new Date("2026-09-15T03:00:00Z"), type: "THU_NO", typeLabel: "Thu nợ", partnerId: 7, partnerName: "Khách Đạt", orderId: null, orderCode: null, amount: "1000000", cashAccountId: 1, cashAccountName: "Tiền mặt",
  reviewStatus: "PENDING_REVIEW", isCancelled: false, note: null, createdByName: "Kế toán A", dateYmd: "2026-09-15", reviewedByName: null, reviewedAt: null, events: [], adjustments: [], ...over,
});
const perms = { canEdit: true, canReview: true, canRequestAdjust: true, canApprove: true };

describe("VoucherDetail", () => {
  it("chờ kiểm: thủ quỹ thấy Kiểm tra xong + Trả lại; kế toán thấy Sửa/Hủy; bấm Kiểm tra gọi API review", async () => {
    render(<VoucherDetail v={detail()} perms={perms} accounts={accounts} />);
    expect(screen.getByText("Chờ kiểm tra")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sửa" })).toHaveAttribute("href", "/accounting/receipts/9/edit");
    expect(screen.getByRole("button", { name: "Hủy phiếu" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Kiểm tra xong" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/vouchers/receipts/9/review", expect.objectContaining({ method: "POST", idempotencyKey: expect.any(String) })));
    expect(refresh).toHaveBeenCalled();
  });
  it("kế toán không thấy nút kiểm tra; đã kiểm ⇒ ẩn Sửa/Hủy, hiện Yêu cầu điều chỉnh; bị trả lại ⇒ 'Sửa & gửi lại' kèm lý do", async () => {
    const { rerender } = render(<VoucherDetail v={detail()} perms={{ ...perms, canReview: false }} accounts={accounts} />);
    expect(screen.queryByRole("button", { name: "Kiểm tra xong" })).not.toBeInTheDocument();
    rerender(<VoucherDetail v={detail({ reviewStatus: "REVIEWED" })} perms={perms} accounts={accounts} />);
    expect(screen.queryByRole("link", { name: "Sửa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hủy phiếu" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yêu cầu điều chỉnh" })).toBeInTheDocument();
    rerender(<VoucherDetail v={detail({ reviewStatus: "RETURNED", events: [{ id: 1, action: "RETURN", actionLabel: "Thủ quỹ trả lại", reason: "sai số tiền", userName: "Thủ quỹ", at: new Date() }] })} perms={perms} accounts={accounts} />);
    expect(screen.getByRole("link", { name: "Sửa & gửi lại" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("sai số tiền");
  });
  it("yêu cầu điều chỉnh bắt buộc lý do; gửi kèm số mới; yêu cầu đang chờ hiện Duyệt/Từ chối cho thủ quỹ", async () => {
    render(<VoucherDetail v={detail({ reviewStatus: "REVIEWED" })} perms={perms} accounts={accounts} />);
    await userEvent.click(screen.getByRole("button", { name: "Yêu cầu điều chỉnh" }));
    await userEvent.type(screen.getByLabelText(/Số tiền mới/), "900000");
    await userEvent.click(screen.getByRole("button", { name: "Gửi yêu cầu" }));
    expect(await screen.findByText("Nhập lý do.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Lý do/), "ghi thừa");
    await userEvent.click(screen.getByRole("button", { name: "Gửi yêu cầu" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/vouchers/receipts/9/adjust", expect.objectContaining({ json: { kind: "AMOUNT", reason: "ghi thừa", newAmount: 900000, newCashAccountId: null } })));
    cleanup();
    render(<VoucherDetail v={detail({ reviewStatus: "REVIEWED", adjustments: [{ id: 4, kind: "VOID", status: "REQUESTED", reason: "nhầm", newAmount: null, newCashAccountName: null, oldAmount: "1000000", requestedByName: "KT", requestedAt: new Date(), decidedByName: null, decidedAt: null, decisionNote: null }] })} perms={perms} accounts={accounts} />);
    expect(screen.getByRole("button", { name: "Duyệt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Từ chối" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yêu cầu điều chỉnh" })).not.toBeInTheDocument();
  });
});

describe("ReviewQueue", () => {
  const row = (over: Partial<QueueRowDTO>): QueueRowDTO => ({ key: "R1", kind: "RECEIPT", id: 1, doc: "RECEIPT", code: "PT000001", at: new Date("2026-09-15T03:00:00Z"), label: "Thu — Thu nợ", partnerName: "Khách Đạt", amount: "1000000", status: "PENDING_REVIEW", statusLabel: "Chờ kiểm tra", createdByName: "KT", detail: null, adjustmentId: null, ...over });
  it("Kiểm tra gọi API review; Trả lại hỏi lý do; điều chỉnh chỉ có Duyệt/Từ chối khi có quyền", async () => {
    render(<ReviewQueue canApprove rows={[row({}), row({ key: "A3", kind: "ADJUSTMENT", status: "ADJUST_REQUESTED", statusLabel: "Chờ duyệt điều chỉnh", code: "PC000002", doc: "PAYMENT", id: 2, adjustmentId: 3 })]} />);
    await userEvent.click(screen.getByRole("button", { name: "Kiểm tra PT000001" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/vouchers/receipts/1/review", expect.objectContaining({ method: "POST" })));
    await userEvent.click(screen.getByRole("button", { name: "Trả lại PT000001" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Trả lại" }));
    expect(await screen.findByText("Nhập lý do.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Lý do"), "thiếu chứng từ");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Trả lại" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/vouchers/receipts/1/return", expect.objectContaining({ json: { reason: "thiếu chứng từ" } })));
    await userEvent.click(screen.getByRole("button", { name: "Duyệt điều chỉnh PC000002" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/cash/adjustments/3", expect.objectContaining({ json: { approve: true, note: "" } })));
    cleanup();
    render(<ReviewQueue canApprove={false} rows={[row({ key: "A3", kind: "ADJUSTMENT", status: "ADJUST_REQUESTED", adjustmentId: 3, code: "PC000002" })]} />);
    expect(screen.queryByRole("button", { name: /Duyệt điều chỉnh/ })).not.toBeInTheDocument();
  });
});

describe("CashBook", () => {
  const book = (): CashBookDTO => ({
    periodName: "Kỳ 1", total: 1,
    accounts: [{ id: 1, name: "Tiền mặt", bankNo: null, type: "CASH", opening: "1000000", in: "500000", out: "200000", balance: "1300000", reviewed: "1500000", pending: "-200000" }],
    selected: { id: 1, name: "Tiền mặt", bankNo: null, type: "CASH", opening: "1000000", in: "500000", out: "200000", balance: "1300000", reviewed: "1500000", pending: "-200000" },
    entries: [{ id: 1, at: new Date("2026-09-15T03:00:00Z"), docType: "RECEIPT", docLabel: "Phiếu thu", docCode: "PT000001", docHref: "/accounting/receipts/1", reviewStatus: "PENDING_REVIEW", amountIn: "500000", amountOut: "0", running: "1500000" }],
    closes: [{ id: 3, closeAt: new Date("2026-09-14T10:00:00Z"), expected: "1000000", actual: "990000", diff: "-10000", reason: "thiếu 10k", createdByName: "Thủ quỹ", createdAt: new Date(), voided: false, voidReason: null }],
  });
  it("3 chỉ số vận hành / đã kiểm / chờ kiểm, chi tiết có số dư chạy; chốt quỹ gửi mốc giờ VN + số kiểm đếm", async () => {
    render(<CashBook book={book()} type="CASH" base="/accounting/cashbook" canClose canReopen nowIso="2026-09-15T10:30:00.000Z" />);
    expect(screen.getByText("Số dư vận hành")).toBeInTheDocument(); expect(screen.getAllByText("Đã kiểm tra").length).toBeGreaterThan(0); expect(screen.getAllByText("Chờ kiểm tra").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "PT000001" })).toHaveAttribute("href", "/accounting/receipts/1");
    expect(screen.getByText(/chênh/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Chốt quỹ" }));
    await userEvent.type(screen.getByLabelText(/Tiền kiểm đếm/), "1300000");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Chốt quỹ" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/cash/closes", expect.objectContaining({ json: { cashAccountId: 1, closeAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:59\.999\+07:00$/), actual: 1300000, reason: "" } })));
  });
  it("không có quyền chốt/hủy chốt ⇒ không hiện nút", () => {
    render(<CashBook book={book()} type="CASH" base="/accounting/cashbook" canClose={false} canReopen={false} nowIso="2026-09-15T10:30:00.000Z" />);
    expect(screen.queryByRole("button", { name: "Chốt quỹ" })).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Hủy chốt" })).not.toBeInTheDocument();
  });
});
