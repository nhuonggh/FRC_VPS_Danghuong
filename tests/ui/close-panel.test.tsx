// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClosePanel } from "@/components/period/ClosePanel";
import type { ClosePreview } from "@/server/period/close";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); refresh.mockReset(); });

const preview: ClosePreview = {
  stock: { lots: 3, products: 2, qty: "16", value: "2550.00" }, receivable: { partners: 2, total: "700.00" }, payable: { partners: 1, total: "500.00" },
  cash: [{ accountId: 1, balance: "1250.00" }], discount: { partners: 1, total: "230.00" },
};
const panel = (over: Partial<Parameters<typeof ClosePanel>[0]> = {}) => <ClosePanel periodName="Kỳ 09/2026" blockerCount={0} warningCount={0} preview={preview} cashNames={{ 1: "Tiền mặt" }} {...over} />;
const openDialog = () => fireEvent.click(screen.getByRole("button", { name: /Kết sổ Kỳ 09\/2026…/ }));
const fill = (name: string, backupAt: string) => {
  fireEvent.change(screen.getByLabelText(/Gõ lại đúng tên kỳ/), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/Thời điểm sao lưu/), { target: { value: backupAt } });
  fireEvent.click(screen.getByRole("checkbox"));
};

describe("ClosePanel", () => {
  it("còn mục chặn → không có nút kết sổ, giải thích lý do", () => {
    render(panel({ blockerCount: 2, preview: null }));
    expect(screen.queryByRole("button", { name: /Kết sổ/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Còn 2 mục chặn/)).toBeInTheDocument();
  });

  it("bước 1 hiện số đầu kỳ mới xem trước (tồn, phải thu, phải trả, quỹ)", () => {
    render(panel());
    expect(screen.getByText("2.550 ₫")).toBeInTheDocument();
    expect(screen.getByText("Tiền mặt")).toBeInTheDocument();
    expect(screen.getByText(/3 lô · 2 mã/)).toBeInTheDocument();
  });

  it("bước 2: nút Kết sổ chỉ bật khi gõ đúng tên kỳ + có giờ sao lưu + tick; gửi đúng payload; thành công → báo kỳ mới", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ closedPeriodId: 1, newPeriod: { id: 2, name: "Kỳ 10/2026" }, carried: { stockLots: 3, draftOrders: 1, quotes: 0 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(panel());
    openDialog();
    const submit = screen.getByRole("button", { name: "Kết sổ" });
    expect(submit).toBeDisabled();
    fill("Kỳ 09/202", "2026-10-01T09:00");
    expect(submit).toBeDisabled(); // tên chưa khớp
    fireEvent.change(screen.getByLabelText(/Gõ lại đúng tên kỳ/), { target: { value: "Kỳ 09/2026" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Đã kết sổ Kỳ 09/2026"));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/period/close");
    expect(JSON.parse(init.body as string)).toMatchObject({ confirmName: "Kỳ 09/2026", acknowledged: true });
    expect(screen.getByRole("status")).toHaveTextContent("Kỳ 10/2026");
    expect(refresh).toHaveBeenCalled();
  });

  it("server từ chối (sao lưu quá cũ) → lỗi hiện ngay tại ô, hộp thoại giữ nguyên", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "x", fields: { backupAt: "Bản sao lưu phải trong 24 giờ qua." } }), { status: 400 })));
    render(panel());
    openDialog();
    fill("Kỳ 09/2026", "2026-09-01T09:00");
    fireEvent.click(screen.getByRole("button", { name: "Kết sổ" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("24 giờ"));
    expect(screen.getByRole("button", { name: "Kết sổ" })).toBeEnabled();
  });
});
