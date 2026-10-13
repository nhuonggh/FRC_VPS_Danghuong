// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripDetail } from "@/components/trips/TripDetail";
import { TripForm } from "@/components/trips/TripForm";
import { UndeliveredList } from "@/components/trips/UndeliveredList";
import type { StopDTO, TripDetailDTO, UndeliveredRowDTO } from "@/server/trips/queries";

const refresh = vi.fn(); const replace = vi.fn(); const apiFetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace, refresh }), usePathname: () => "/delivery/trips", useSearchParams: () => new URLSearchParams("") }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));
vi.mock("@/lib/confirm-store", () => ({ confirm: async () => true }));
beforeEach(() => {
  refresh.mockReset(); replace.mockReset(); apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string) => (url.startsWith("/api/trips/orders") ? [
    { id: 11, code: "DH000011", partnerName: "Khách Đạt", address: "Q12", phone: "0912", orderDate: "2026-09-15", expectedDate: "2026-09-16", remainingQty: "4", note: null },
    { id: 12, code: "DH000012", partnerName: "Trần B", address: "Gò Vấp", phone: null, orderDate: "2026-09-15", expectedDate: null, remainingQty: "2", note: null }] : { id: 5 }));
});
afterEach(cleanup);

const options = { vehicles: [{ id: 1, name: "51C-12345" }], drivers: [{ id: 2, name: "Lái A" }], assistants: [{ id: 3, name: "Phụ B" }], routes: [{ id: 4, name: "Quận 12" }] };

describe("TripForm", () => {
  it("chọn đơn, đổi thứ tự, bỏ đơn; thiếu đơn ⇒ báo lỗi; đủ ⇒ POST đúng thứ tự + khoá idempotency", async () => {
    render(<TripForm today="2026-09-16" options={options} />);
    await userEvent.click(screen.getByRole("button", { name: "Tạo chuyến" }));
    expect(await screen.findByText("Chọn ít nhất một đơn.")).toBeInTheDocument();
    expect(apiFetch.mock.calls.some((c) => c[0] === "/api/trips")).toBe(false);
    await userEvent.click(await screen.findByRole("button", { name: "Thêm DH000011" }));
    await userEvent.click(await screen.findByRole("button", { name: "Thêm DH000012" }));
    await userEvent.click(screen.getByRole("button", { name: "Lên DH000012" }));
    await userEvent.selectOptions(screen.getByLabelText("Phụ xe"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Tạo chuyến" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/delivery/trips/5"));
    const [, init] = apiFetch.mock.calls.find((c) => c[0] === "/api/trips")!;
    expect(init.json).toMatchObject({ date: "2026-09-16", vehicleId: 1, driverId: 2, assistantId: 3, routeId: null, orderIds: [12, 11] });
    expect(init.idempotencyKey).toBeTruthy();
  });
});

const line = { orderLineId: 100, productCode: "TX01", productName: "Tôn xốp", unit: "md", qty: "4", delivered: "0", remaining: "4", processingTypeName: "Tôn xốp 6S" };
const stop = (over: Partial<StopDTO> = {}): StopDTO => ({
  id: 1, seq: 1, orderId: 11, orderCode: "DH000011", orderTotal: "200000", partnerId: 7, partnerName: "Khách Đạt", phone: "0912", address: "Q12", allowCredit: true, debtLimit: "0",
  result: null, resultLabel: null, due: null, cash: "0", transfer: "0", debt: "0", promiseDate: null, resultNote: null, resultAt: null, suggestedDue: "200000", lines: [line], deliveryNoteId: null, handledNote: null, canCancelResult: false, ...over,
});
const trip = (over: Partial<TripDetailDTO> = {}): TripDetailDTO => ({
  id: 3, code: "CH000003", date: "2026-09-16", status: "PLANNED", statusLabel: "Đã xếp", note: null, routeName: "Quận 12", vehiclePlate: "51C-12345", driverName: "Lái A", assistantName: "Phụ B", departedAt: null, returnedAt: null, createdByName: "KT",
  totals: { expected: "0", cash: "0", transfer: "0", debt: "0", diff: "0" }, settled: null, confirmed: null, cancelReason: null, stops: [stop()], receipts: [], ...over,
});
const allPerms = { canManage: true, canSettle: true, canConfirm: true };
const accounts = [{ id: 1, name: "Tiền mặt", type: "CASH" as const }, { id: 2, name: "VCB", type: "BANK" as const }];

describe("TripDetail — nhập kết quả (40)", () => {
  it("giao đủ: gợi ý tiền mặt = phải thu; POST kết quả kèm khoá; chuyến PLANNED có Xuất phát + Hủy chuyến", async () => {
    render(<TripDetail trip={trip()} perms={allPerms} accounts={accounts} />);
    expect(screen.getByRole("button", { name: "Xuất phát" })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Hủy chuyến" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Nhập kết quả DH000011" }));
    expect(screen.getByLabelText("Tiền mặt")).toHaveValue("200.000");
    await userEvent.click(screen.getByRole("button", { name: "Lưu kết quả" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/trips/3/result", expect.objectContaining({ json: { orderId: 11, result: "GIAO_DU", lines: [], cashAmount: 200000, transferAmount: 0, debtAmount: 0, promiseDate: null, note: "" }, idempotencyKey: expect.any(String) })));
    expect(refresh).toHaveBeenCalled();
  });
  it("không giao được bắt buộc lý do (server), hẹn trả hiện ô ngày, giao một phần nhập SL từng dòng và chặn vượt SL còn lại", async () => {
    render(<TripDetail trip={trip()} perms={allPerms} accounts={accounts} />);
    await userEvent.click(screen.getByRole("button", { name: "Nhập kết quả DH000011" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Kết quả/ }), "HEN_TRA");
    expect(screen.getByLabelText(/Ngày khách hẹn trả/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: /^Kết quả/ }), "GIAO_MOT_PHAN");
    await userEvent.type(screen.getByLabelText("SL giao TX01"), "9");
    await userEvent.click(screen.getByRole("button", { name: "Lưu kết quả" }));
    expect(await screen.findByText(/chỉ còn 4/)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
    await userEvent.clear(screen.getByLabelText("SL giao TX01")); await userEvent.type(screen.getByLabelText("SL giao TX01"), "1");
    await userEvent.clear(screen.getByLabelText("Tiền mặt")); await userEvent.type(screen.getByLabelText("Tiền mặt"), "50000");
    await userEvent.click(screen.getByRole("button", { name: "Lưu kết quả" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/trips/3/result", expect.objectContaining({ json: expect.objectContaining({ result: "GIAO_MOT_PHAN", lines: [{ orderLineId: 100, qty: 1 }], cashAmount: 50000 }) })));
  });
  it("điểm đã có kết quả: sửa/xóa; chuyến đã đối soát khoá nhập; đối soát có chênh lệch bắt buộc lý do", async () => {
    const done = stop({ result: "GIAO_DU", resultLabel: "Giao đủ", due: "200000", cash: "150000", canCancelResult: true });
    const { unmount } = render(<TripDetail trip={trip({ status: "RETURNED", statusLabel: "Đã về", stops: [done], totals: { expected: "200000", cash: "150000", transfer: "0", debt: "0", diff: "50000" } })} perms={allPerms} accounts={accounts} />);
    expect(screen.getByRole("button", { name: "Sửa kết quả DH000011" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Xóa kết quả DH000011" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/trips/3/clear-result", expect.objectContaining({ json: { orderId: 11 } })));
    await userEvent.click(screen.getByRole("button", { name: "Đối soát lái xe" }));
    const dlg = within(screen.getByRole("dialog"));
    await userEvent.click(dlg.getByRole("button", { name: "Đối soát" }));
    expect(await screen.findByText("Có chênh lệch — nhập lý do.")).toBeInTheDocument();
    await userEvent.type(dlg.getByLabelText(/Lý do chênh lệch/), "thiếu 50k");
    await userEvent.click(dlg.getByRole("button", { name: "Đối soát" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/trips/3/settle", expect.objectContaining({ json: { reason: "thiếu 50k" }, idempotencyKey: expect.any(String) })));
    unmount();
    render(<TripDetail trip={trip({ status: "SETTLED", statusLabel: "Đã đối soát", stops: [done] })} perms={allPerms} accounts={accounts} />);
    expect(screen.queryByRole("button", { name: /Sửa kết quả|Xóa kết quả|Nhập kết quả/ })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("chưa vào quỹ");
  });
  it("thủ quỹ xác nhận: chọn quỹ + tài khoản NH theo số tiền; thiếu quyền ⇒ ẩn nút", async () => {
    const paid = stop({ result: "GIAO_DU", resultLabel: "Giao đủ", due: "200000", cash: "150000", transfer: "50000" });
    const t = trip({ status: "SETTLED", statusLabel: "Đã đối soát", stops: [paid], totals: { expected: "200000", cash: "150000", transfer: "50000", debt: "0", diff: "0" } });
    const { unmount } = render(<TripDetail trip={t} perms={allPerms} accounts={accounts} />);
    await userEvent.click(screen.getByRole("button", { name: "Xác nhận đã nhận tiền" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Đã nhận tiền" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/trips/3/confirm", expect.objectContaining({ json: { cashAccountId: 1, transferAccountId: 2 }, idempotencyKey: expect.any(String) })));
    unmount();
    render(<TripDetail trip={t} perms={{ canManage: true, canSettle: true, canConfirm: false }} accounts={[]} />);
    expect(screen.queryByRole("button", { name: "Xác nhận đã nhận tiền" })).not.toBeInTheDocument();
  });
});

describe("UndeliveredList", () => {
  const row = (over: Partial<UndeliveredRowDTO> = {}): UndeliveredRowDTO => ({ stopId: 9, tripId: 3, tripCode: "CH000003", orderId: 11, orderCode: "DH000011", partnerName: "Khách Đạt", phone: "0912", address: "Q12", result: "KHONG_GIAO", resultLabel: "Không giao được", note: "khách vắng", remainingQty: "4", at: new Date("2026-09-16T03:00:00Z"), handledNote: null, handledAt: null, ...over });
  it("có Giao lại / Trả về kho / Đã xử lý (bắt buộc ghi cách xử lý); đã xử lý thì hiện ghi chú", async () => {
    render(<UndeliveredList canManage rows={[row(), row({ stopId: 10, orderCode: "DH000012", handledAt: new Date(), handledNote: "giao lại thứ 6" })]} />);
    expect(screen.getByRole("link", { name: "Trả về kho" })).toHaveAttribute("href", "/returns/by-order/new?orderId=11&undelivered=1");
    expect(screen.getByText(/giao lại thứ 6/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Đã xử lý DH000011" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Ghi nhận" }));
    expect(await screen.findByText("Nhập lý do.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Lý do"), "đã hủy đơn");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Ghi nhận" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/trips/stops/9/handle", expect.objectContaining({ json: { note: "đã hủy đơn" } })));
  });
});
