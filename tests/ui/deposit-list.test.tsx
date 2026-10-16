// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DepositTable } from "@/components/sales/DepositTable";
import { DepositListControls } from "@/components/sales/DepositListControls";
import { DepositActions } from "@/components/sales/DepositActions";
import { activeDepositTime, depositTimeOptions } from "@/lib/deposit-list";
import { parseListParams } from "@/lib/query-params";
import type { DepositRowDTO } from "@/server/deposits/queries";

const { push, refresh, api, confirm } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), api: vi.fn(), confirm: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: api }));
vi.mock("@/lib/confirm-store", () => ({ confirm }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const now = new Date("2026-01-01T03:00:00Z");
const row: DepositRowDTO = { id: 1, code: "PT001", at: now, partnerName: "Nguyễn Văn An", orderId: 8, orderCode: "DH000008", amount: "35000", cashAccountName: "Quỹ tiền mặt", isCancelled: false, reviewed: true, note: null };

describe("deposit list UI", () => {
  it("shows the cashbook lock, allows release, and blocks cancellation in both desktop and mobile views", () => {
    render(<DepositTable rows={[row]} canOpen />);
    expect(screen.getAllByText("Đã vào sổ quỹ")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Chuyển cọc PT001 thành số dư" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Hủy phiếu cọc PT001" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "DH000008" })[0]).toHaveAttribute("href", "/sales/orders/8?tab=deposit");
  });
  it("cancelled receipts have struck-through amounts and no mutation actions", () => {
    render(<DepositTable rows={[{ ...row, isCancelled: true }]} canOpen={false} />);
    expect(screen.getAllByText("35.000 ₫")[0]).toHaveClass("line-through");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "DH000008" })).not.toBeInTheDocument();
  });
  it("yesterday crosses the year boundary and quick filters preserve customer and state while resetting pagination", () => {
    const params = parseListParams({ state: "attached", customer: "12", page: "3", timePreset: "today" }, ["state", "customer"]);
    render(<DepositListControls params={params} customers={[{ id: 12, name: "Nguyễn Văn An" }]} counts={{ yesterday: 3 }} now={now} />);
    const nav = screen.getByRole("navigation", { name: "Lọc nhanh theo ngày" });
    const url = new URL(within(nav).getByRole("link", { name: "Hôm qua 3" }).getAttribute("href")!, "https://example.test");
    expect(url.searchParams.get("timeStart")).toBe("2025-12-31");
    expect(url.searchParams.get("timeEnd")).toBe("2025-12-31");
    expect(url.searchParams.get("state")).toBe("attached");
    expect(url.searchParams.get("customer")).toBe("12");
    expect(url.searchParams.has("page")).toBe(false);
    const yesterday = depositTimeOptions(now).find((p) => p.key === "yesterday")!.patch;
    expect(activeDepositTime({ ...params, ...yesterday }, now)).toBe("yesterday");
  });
  it("requires confirmation and disables mutations while the API is pending", async () => {
    let complete!: () => void;
    confirm.mockResolvedValue(true);
    api.mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
    render(<DepositActions id={1} code="PT001" attached reviewed={false} cashAccountName="Quỹ tiền mặt" iconOnly />);
    await userEvent.click(screen.getByRole("button", { name: "Hủy phiếu cọc PT001" }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
    expect(api).toHaveBeenCalledWith("/api/deposits/1/cancel", { method: "POST" });
    expect(screen.getByRole("button", { name: "Hủy phiếu cọc PT001" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Chuyển cọc PT001 thành số dư" })).toBeDisabled();
    complete();
    expect(await screen.findByRole("button", { name: "Hủy phiếu cọc PT001" })).toBeEnabled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
