// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscountDetail } from "@/components/discount/DiscountDetail";
import { DiscountList } from "@/components/discount/DiscountList";
import type { DiscountDetailDTO } from "@/server/discount/queries";

const refresh = vi.fn(); const apiFetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }), usePathname: () => "/accounting/discounts", useSearchParams: () => new URLSearchParams("") }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));
vi.mock("@/lib/confirm-store", () => ({ confirm: async () => true }));
beforeEach(() => { refresh.mockReset(); apiFetch.mockReset(); apiFetch.mockResolvedValue({ id: 1, code: "CK000001" }); });
afterEach(cleanup);

const detail = (over: Partial<DiscountDetailDTO> = {}): DiscountDetailDTO => ({
  partner: { id: 7, code: "KH000007", name: "Khách Đạt", debtBalance: "200000" }, opening: "500000", accrued: "40000", settled: "0", forfeited: "0", balance: "540000", negative: false, total: 1,
  entries: [{ id: 1, at: new Date("2026-09-15T03:00:00Z"), docType: "SALE", docLabel: "Đơn hàng", docCode: "DH000001", docHref: "/sales/orders/1", orderCode: "DH000001", amountIn: "40000", amountOut: "0", running: "540000", method: null, isReconciled: false }],
  settlements: [
    { id: 3, code: "CK000003", at: new Date("2026-09-14T03:00:00Z"), method: "CASH", methodLabel: "Chi tiền", amount: "100000", note: null, paymentId: 5, paymentCode: "PC000005", isCancelled: false, cancelReason: null, isReconciled: false, reconciledByName: null, createdByName: "KT" },
    { id: 2, code: "CK000002", at: new Date("2026-09-13T03:00:00Z"), method: "OFFSET", methodLabel: "Trừ vào công nợ", amount: "50000", note: null, paymentId: null, paymentCode: null, isCancelled: false, cancelReason: null, isReconciled: true, reconciledByName: "KTT", createdByName: "KT" },
  ], ...over,
});
const accounts = [{ id: 1, name: "Tiền mặt" }];

describe("DiscountDetail — chuyển vào lãi", () => {
  const forfeitSettle = { id: 4, code: "CK000004", at: new Date("2026-09-16T03:00:00Z"), method: "FORFEIT" as const, methodLabel: "Chuyển vào lãi công ty", amount: "10000", note: null, paymentId: null, paymentCode: null, isCancelled: false, cancelReason: null, isReconciled: false, reconciledByName: null, createdByName: "KT" };
  it("hiện tổng đã chuyển vào lãi + tháng + link báo cáo lọc đúng tháng khi có quyền xem lãi", () => {
    render(<DiscountDetail d={detail({ forfeited: "10000", settlements: [forfeitSettle] })} perms={{ canSettle: true, canReconcile: false, canViewProfit: true }} accounts={accounts} today="2026-09-15" />);
    expect(screen.getByText(/Đã chuyển vào lãi công ty:/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Đã tính vào lãi tháng 09\/2026/ });
    expect(link).toHaveAttribute("href", "/reports/period-pnl?timePreset=custom&timeStart=2026-09-01&timeEnd=2026-09-30");
  });
  it("không có quyền xem lãi ⇒ chỉ chữ, không link; không có phiếu FORFEIT ⇒ không hiện khung", () => {
    const { unmount } = render(<DiscountDetail d={detail({ forfeited: "10000", settlements: [forfeitSettle] })} perms={{ canSettle: true, canReconcile: false }} accounts={accounts} today="2026-09-15" />);
    expect(screen.getByText(/Đã tính vào lãi tháng 09\/2026/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Lãi lỗ/ })).toBeNull();
    unmount();
    render(<DiscountDetail d={detail()} perms={{ canSettle: true, canReconcile: false, canViewProfit: true }} accounts={accounts} today="2026-09-15" />);
    expect(screen.queryByText(/Đã chuyển vào lãi công ty:/)).toBeNull();
  });
});

describe("DiscountDetail", () => {
  it("tất toán CASH: vượt số dư bị chặn ở form; đủ ⇒ POST kèm quỹ + khoá idempotency", async () => {
    render(<DiscountDetail d={detail()} perms={{ canSettle: true, canReconcile: true }} accounts={accounts} today="2026-09-15" />);
    await userEvent.click(screen.getByRole("button", { name: "Tất toán chiết khấu" }));
    await userEvent.clear(screen.getByLabelText(/Số tiền/)); await userEvent.type(screen.getByLabelText(/Số tiền/), "600000");
    await userEvent.click(screen.getByRole("button", { name: "Tất toán" }));
    expect(await screen.findByText(/Tối đa/)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText(/Số tiền/)); await userEvent.type(screen.getByLabelText(/Số tiền/), "300000");
    await userEvent.click(screen.getByRole("button", { name: "Tất toán" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/discount/settlements", expect.objectContaining({ json: { partnerId: 7, method: "CASH", amount: 300000, cashAccountId: 1, date: "2026-09-15", note: "" }, idempotencyKey: expect.any(String) })));
    expect(refresh).toHaveBeenCalled();
  });
  it("OFFSET giới hạn theo số khách đang nợ và ẩn ô quỹ", async () => {
    render(<DiscountDetail d={detail()} perms={{ canSettle: true, canReconcile: false }} accounts={accounts} today="2026-09-15" />);
    await userEvent.click(screen.getByRole("button", { name: "Tất toán chiết khấu" }));
    await userEvent.selectOptions(screen.getByLabelText(/Hình thức/), "OFFSET");
    expect(screen.queryByLabelText(/Chi từ quỹ/)).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(/Số tiền/)); await userEvent.type(screen.getByLabelText(/Số tiền/), "250000");
    await userEvent.click(screen.getByRole("button", { name: "Tất toán" }));
    expect(await screen.findByText(/Tối đa 200\.000/)).toBeInTheDocument();
  });
  it("chi 300.000 và chuyển phần còn lại vào lãi công ty ⇒ POST kèm forfeitAmount = số còn lại", async () => {
    render(<DiscountDetail d={detail()} perms={{ canSettle: true, canReconcile: false }} accounts={accounts} today="2026-09-15" />);
    await userEvent.click(screen.getByRole("button", { name: "Tất toán chiết khấu" }));
    await userEvent.clear(screen.getByLabelText(/Số tiền/)); await userEvent.type(screen.getByLabelText(/Số tiền/), "300000");
    await userEvent.click(screen.getByLabelText(/Chuyển vào lãi công ty/));
    await userEvent.click(screen.getByRole("button", { name: "Tất toán" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/discount/settlements", expect.objectContaining({ json: expect.objectContaining({ method: "CASH", amount: 300000, forfeitAmount: 240000 }) })));
  });
  it("phiếu chờ hậu kiểm có Hậu kiểm + Hủy, phiếu đã hậu kiểm thì không; hậu kiểm gọi API; thiếu quyền ẩn nút", async () => {
    const { unmount } = render(<DiscountDetail d={detail()} perms={{ canSettle: true, canReconcile: true }} accounts={accounts} today="2026-09-15" />);
    expect(screen.getByRole("button", { name: "Hậu kiểm CK000003" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hủy CK000003" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hậu kiểm CK000002" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hủy CK000002" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Hậu kiểm CK000003" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/discount/settlements/3/reconcile", expect.objectContaining({ method: "POST" })));
    unmount();
    render(<DiscountDetail d={detail()} perms={{ canSettle: false, canReconcile: false }} accounts={accounts} today="2026-09-15" />);
    expect(screen.queryByRole("button", { name: /Hậu kiểm CK|Hủy CK|Tất toán chiết khấu/ })).not.toBeInTheDocument();
  });
  it("hủy phiếu bắt buộc lý do; số dư âm hiện cảnh báo", async () => {
    render(<DiscountDetail d={detail({ negative: true, balance: "-40000" })} perms={{ canSettle: true, canReconcile: false }} accounts={accounts} today="2026-09-15" />);
    expect(screen.getByRole("alert")).toHaveTextContent("ÂM");
    await userEvent.click(screen.getByRole("button", { name: "Hủy CK000003" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Hủy tất toán" }));
    expect(await screen.findByText("Nhập lý do.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Lý do"), "nhập nhầm");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Hủy tất toán" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/discount/settlements/3/cancel", expect.objectContaining({ json: { reason: "nhập nhầm" } })));
  });
});

describe("DiscountList", () => {
  it("hiện số dư, cảnh báo số dư âm và phiếu chờ hậu kiểm", () => {
    render(<DiscountList total={2} summary={{ balance: "460000", negative: 1, partners: 5 }} params={{ page: 1, pageSize: 20, filters: {} }} rows={[
      { partnerId: 7, code: "KH000007", name: "Khách Đạt", groupName: "Khách lẻ", opening: "500000", accrued: "0", settled: "100000", balance: "400000", unreconciled: 1 },
      { partnerId: 8, code: "KH000008", name: "Trần B", groupName: "Khách lẻ", opening: "0", accrued: "0", settled: "40000", balance: "-40000", unreconciled: 0 }]} />);
    expect(screen.getByText("1 phiếu chờ hậu kiểm")).toBeInTheDocument();
    expect(screen.getAllByText("Số dư âm").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "KH000007" })).toHaveAttribute("href", "/accounting/discounts/7");
  });
});
