// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CancelDebtButton } from "@/components/debt/CancelDebtButton";
import { DebtAdjustmentForm } from "@/components/debt/DebtAdjustmentForm";
import { DebtTransferForm } from "@/components/debt/DebtTransferForm";

const refresh = vi.fn();
const replace = vi.fn();
const apiFetch = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh }),
  usePathname: () => "/accounting/debt-adjustments/new",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

beforeEach(() => {
  refresh.mockReset(); replace.mockReset(); apiFetch.mockReset();
  apiFetch.mockImplementation(async (url: string) => (url.startsWith("/api/debts/partners") ? [{ value: 7, label: "KH000007 — Nguyễn Văn Đạt" }, { value: 8, label: "KH000008 — Trần Thị B" }] : { id: 1, code: "DC000001" }));
});
afterEach(cleanup);

async function pick(name: string, text: string, index = 0) {
  const box = screen.getByRole("combobox", { name });
  await userEvent.click(box);
  await userEvent.type(box, text);
  await userEvent.click((await within(await screen.findByRole("listbox")).findAllByRole("option"))[index]!);
}

describe("DebtAdjustmentForm (64)", () => {
  it("thiếu ghi chú ⇒ báo lỗi, không gọi API; đủ ⇒ POST kèm khoá idempotency", async () => {
    render(<DebtAdjustmentForm today="2026-09-15" partner={null} />);
    await pick("Đối tác", "dat");
    await userEvent.type(screen.getByLabelText(/Số tiền/), "100000");
    await userEvent.click(screen.getByRole("button", { name: "Lưu điều chỉnh" }));
    expect(await screen.findByText("Nhập ghi chú.")).toBeInTheDocument();
    expect(apiFetch.mock.calls.some((c) => c[0] === "/api/debts/adjustments")).toBe(false);
    await userEvent.type(screen.getByLabelText(/Ghi chú/), "Tôn móp");
    await userEvent.click(screen.getByRole("button", { name: "Lưu điều chỉnh" }));
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => c[0] === "/api/debts/adjustments")).toBe(true));
    const [, init] = apiFetch.mock.calls.find((c) => c[0] === "/api/debts/adjustments")!;
    expect(init.json).toMatchObject({ partnerId: 7, reason: "HANG_LOI", direction: "DECREASE", amount: 100000, note: "Tôn móp" });
    expect(init.idempotencyKey).toBeTruthy();
    expect(replace).toHaveBeenCalledWith("/accounting/debts/7");
  });

  it("lý do chiết khấu tích lũy khoá chiều 'giảm số dư'", async () => {
    render(<DebtAdjustmentForm today="2026-09-15" partner={{ value: 7, label: "KH000007 — Nguyễn Văn Đạt" }} />);
    await userEvent.selectOptions(screen.getByLabelText(/Lý do/), "CHIET_KHAU");
    expect(screen.getByLabelText(/Tác động lên số dư/)).toBeDisabled();
    expect(screen.getByText(/tiêu hao số dư chiết khấu/)).toBeInTheDocument();
  });
});

describe("DebtTransferForm (65)", () => {
  it("gộp mã: không có ô số tiền; gửi kind MERGE", async () => {
    render(<DebtTransferForm today="2026-09-15" />);
    await userEvent.selectOptions(screen.getByLabelText(/Hình thức/), "MERGE");
    expect(screen.queryByLabelText(/Số tiền/)).toBeNull();
    await pick("Mã cần gộp (sẽ ngừng)", "dat", 0);
    await pick("Mã giữ lại", "tran", 1);
    await userEvent.click(screen.getByRole("button", { name: "Gộp mã" }));
    await waitFor(() => expect(apiFetch.mock.calls.some((c) => c[0] === "/api/debts/transfers")).toBe(true));
    const [, init] = apiFetch.mock.calls.find((c) => c[0] === "/api/debts/transfers")!;
    expect(init.json).toMatchObject({ kind: "MERGE", fromPartnerId: 7, toPartnerId: 8 });
    expect(init.json.amount).toBeUndefined();
    expect(replace).toHaveBeenCalledWith("/accounting/debt-transfers");
  });

  it("chuyển một phần cần số tiền > 0", async () => {
    render(<DebtTransferForm today="2026-09-15" />);
    await pick("Bên chuyển (giảm số dư)", "dat", 0);
    await pick("Bên nhận (tăng số dư)", "tran", 1);
    await userEvent.click(screen.getByRole("button", { name: "Chuyển công nợ" }));
    expect(await screen.findByText("Nhập số tiền lớn hơn 0.")).toBeInTheDocument();
  });
});

describe("CancelDebtButton", () => {
  it("bắt buộc lý do rồi POST /api/debts/adjustments/3/cancel", async () => {
    render(<CancelDebtButton kind="adjustments" id={3} code="DC000003" />);
    await userEvent.click(screen.getByRole("button", { name: "Hủy phiếu DC000003" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Lý do"), "Nhập nhầm");
    await userEvent.click(within(dialog).getByRole("button", { name: "Hủy phiếu" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/debts/adjustments/3/cancel", { method: "POST", json: { reason: "Nhập nhầm" } }));
    expect(refresh).toHaveBeenCalled();
  });
});
