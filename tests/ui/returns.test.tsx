// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReturnByOrderForm } from "@/components/returns/ReturnByOrderForm";
import { ReturnDetail } from "@/components/returns/ReturnDetail";
import type { ReturnDetailDTO, ReturnableOrderDTO } from "@/server/returns/queries";

const refresh = vi.fn();
const replace = vi.fn();
const apiFetch = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh }),
  usePathname: () => "/returns/1",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

beforeEach(() => { refresh.mockReset(); replace.mockReset(); apiFetch.mockReset(); });
afterEach(cleanup);

const order: ReturnableOrderDTO = {
  id: 1, code: "DH000001", partnerCode: "KH000001", partnerName: "Nguyễn Văn Đạt", orderDate: new Date("2026-09-10T03:00:00Z"), partnerIsRetail: false, undelivered: false,
  lines: [
    { id: 11, productCode: "TX01", productName: "Tôn xốp", unit: "md", ordered: "4", delivered: "4", returned: "1", remaining: "3", returnable: true, processingTypeName: "Tôn xốp 11 sóng" },
    { id: 12, productCode: "TX02", productName: "Tôn gia công", unit: "md", ordered: "2", delivered: "2", returned: "0", remaining: "2", returnable: false, processingTypeName: null },
  ],
};

describe("ReturnByOrderForm (43)", () => {
  it("hiện đã giao/đã trả/còn trả; dòng gia công bị khoá; gửi POST kèm khoá idempotency", async () => {
    apiFetch.mockResolvedValueOnce({ id: 5 });
    render(<ReturnByOrderForm order={order} today="2026-09-15" />);
    expect(screen.getByLabelText("SL trả dòng 2")).toBeDisabled();
    expect(screen.getByText(/không trả theo đơn/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("SL trả dòng 1"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Lập phiếu trả" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const [url, init] = apiFetch.mock.calls[0]!;
    expect(url).toBe("/api/returns/by-order");
    expect(init.json).toMatchObject({ orderId: 1, date: "2026-09-15", lines: [{ orderLineId: 11, qty: 2 }] });
    expect(init.idempotencyKey).toBeTruthy();
    expect(replace).toHaveBeenCalledWith("/returns/5");
  });

  it("chưa nhập SL nào ⇒ báo lỗi, không gọi API", async () => {
    render(<ReturnByOrderForm order={order} today="2026-09-15" />);
    await userEvent.click(screen.getByRole("button", { name: "Lập phiếu trả" }));
    expect(await screen.findByText("Nhập số lượng trả cho ít nhất một dòng.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

const ret = (over: Partial<ReturnDetailDTO> = {}): ReturnDetailDTO => ({
  id: 7, code: "TH000007", kind: "BY_ORDER", at: new Date("2026-09-15T03:00:00Z"), partnerCode: "KH000001", partnerName: "Nguyễn Văn Đạt", orderId: 1, orderCode: "DH000001",
  isCancelled: false, note: null, cancelReason: null, createdByName: "An", returnTotal: "45000",
  lines: [{ id: 1, productCode: "TX01", productName: "Tôn xốp", unit: "md", qty: "1", salePrice: "45000", lineAmount: "45000" }], ...over,
});

describe("ReturnDetail", () => {
  it("hủy phiếu bắt buộc lý do rồi POST /api/returns/7/cancel", async () => {
    apiFetch.mockResolvedValueOnce({ ok: true });
    render(<ReturnDetail ret={ret()} canManage />);
    await userEvent.click(screen.getByRole("button", { name: "Hủy phiếu trả" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Lý do"), "Nhập nhầm");
    await userEvent.click(within(dialog).getByRole("button", { name: "Hủy phiếu trả" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/returns/7/cancel", { method: "POST", json: { reason: "Nhập nhầm" } }));
    expect(refresh).toHaveBeenCalled();
  });

  it("đã hủy hoặc không quyền: không có nút hủy; thiếu giá ⇒ ẩn cột tiền", () => {
    render(<ReturnDetail ret={ret({ isCancelled: true, cancelReason: "Sai" })} canManage />);
    expect(screen.queryByRole("button", { name: "Hủy phiếu trả" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Lý do: Sai");
    cleanup();
    const { returnTotal: _t, ...rest } = ret();
    render(<ReturnDetail ret={{ ...rest, lines: [{ id: 1, productCode: "TX01", productName: "Tôn xốp", unit: "md", qty: "1" }] }} canManage={false} />);
    expect(screen.queryByRole("button", { name: "Hủy phiếu trả" })).toBeNull();
  });
});
