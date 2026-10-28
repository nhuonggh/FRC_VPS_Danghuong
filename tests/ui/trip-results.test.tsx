// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TripResultsView } from "@/components/trips/TripResultsView";
import { parseListParams } from "@/lib/query-params";
import { TRIP_RESULTS_FILTER_KEYS, type TripDetailDTO, type StopDTO, type TripRowDTO, type TripStatsDTO, type TripResultsSummary } from "@/server/trips/queries";

const { replace, refresh, push, api } = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn(), api: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh, push }) }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: api }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const stats: TripStatsDTO = { active: 2, returned: 1, settled: 0, confirmed: 0, all: 4, counts: { PLANNED: 1, ON_ROAD: 1, RETURNED: 1, SETTLED: 0, CONFIRMED: 0, CANCELLED: 1 } };
const summary: TripResultsSummary = { total: 4, stops: 5, completed: 2, pending: 2, expected: "400000", collected: "350000", outstanding: "50000", paidTrips: 1, unpaidTrips: 2, tabPaidTrips: 1, tabUnpaidTrips: 2, tabAllTrips: 4, filteredExpected: "400000", filteredCollected: "350000", counts: stats.counts };
const row: TripRowDTO = { id: 1, code: "CH000001", date: "2026-10-16", status: "PLANNED", statusLabel: "Đã xếp", routeName: "Tuyến A", vehiclePlate: "51C-12345", driverName: "Lái A", assistantName: null, stops: 1, done: 0, expected: "0", collected: "0", cash: "0", transfer: "0", collectionStatus: "unpaid" };
const stop: StopDTO = { id: 10, seq: 1, orderId: 11, orderCode: "DH000011", partnerId: 7, partnerName: "Khách Đạt", orderTotal: "200000", phone: null, address: null, allowCredit: true, debtLimit: "0", result: null, resultLabel: null, due: null, cash: "0", transfer: "0", cashAccountId: null, transferAccountId: null, debt: "0", discount: "0", over: "0", promiseDate: null, resultNote: null, resultAt: null, suggestedDue: "200000", lines: [], deliveryNoteId: null, handledNote: null, canCancelResult: false };
const detail: TripDetailDTO = { ...row, note: null, departedAt: null, returnedAt: null, createdByName: "KT", totals: { expected: "0", cash: "0", transfer: "0", debt: "0", discount: "0", over: "0", diff: "0", expense: "0" }, settled: null, confirmed: null, cancelReason: null, stops: [stop], receipts: [], expenses: [] };
const props = { rows: [row], total: 1, stats, summary, vehicles: [], customers: [{ id: 7, name: "Khách Đạt" }], routes: [], detail: null, accounts: [{ id: 1, name: "Quỹ tiền mặt", type: "CASH" as const }] };
const params = (sp: Record<string, string> = {}) => parseListParams(sp, TRIP_RESULTS_FILTER_KEYS);

describe("delivery results reference layout", () => {
  it("shows the four metrics, grouped status tabs and collection controls with deep links", () => {
    render(<TripResultsView {...props} params={params({ customer: "7", page: "2", detail: "1" })} />);
    expect(screen.getByText("Tổng số chuyến")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Điểm giao hoàn tất" })).toHaveAttribute("aria-valuenow", "2");
    const tabs = screen.getByRole("navigation", { name: "Trạng thái kết quả giao" });
    expect(within(tabs).getAllByRole("link")).toHaveLength(5);
    const url = new URL(within(tabs).getByRole("link", { name: "Hoàn tất kết quả 1" }).getAttribute("href")!, "https://example.test");
    expect(url.searchParams.get("resultState")).toBe("done");
    expect(url.searchParams.get("customer")).toBe("7");
    expect(url.searchParams.has("page")).toBe(false);
    expect(url.searchParams.has("detail")).toBe(false);
    expect(screen.getByRole("navigation", { name: "Kết quả thu" })).toBeInTheDocument();
    expect(screen.getByText(/điểm chưa nhập chưa được cộng tiền/)).toBeInTheDocument();
  });
  it("is view-only: expands stop details, highlights matching customers, and sends entry to the trip detail page", () => {
    render(<TripResultsView {...props} detail={detail} params={params({ detail: "1", customer: "7", entry: "first" })} />);
    expect(screen.getByRole("heading", { name: "Kết quả giao" })).toBeInTheDocument();
    expect(screen.getAllByText("Khách Đạt").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Xem điểm giao CH000001" })[0]).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Nhập kết quả DH000011/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Xem chuyến CH000001" })[0]).toHaveAttribute("href", "/delivery/trips/1");
    expect(screen.getAllByRole("link", { name: /Nhập \/ sửa kết quả tại chi tiết chuyến/ })[0]).toHaveAttribute("href", "/delivery/trips/1");
    expect(screen.getAllByText("DH000011").length).toBeGreaterThan(0);
  });
  it("closed periods and settled trips show a read-only notice", () => {
    const { unmount } = render(<TripResultsView {...props} detail={detail} params={params({ detail: "1" })} closedPeriodName="Tháng 9" />);
    expect(screen.getAllByText(/đã đóng, kết quả chỉ được xem/)).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /Nhập \/ sửa kết quả/ })).not.toBeInTheDocument();
    unmount();
    render(<TripResultsView {...props} rows={[{ ...row, status: "SETTLED" }]} detail={{ ...detail, status: "SETTLED" }} params={params({ detail: "1" })} />);
    expect(screen.queryByRole("link", { name: /Nhập \/ sửa kết quả/ })).not.toBeInTheDocument();
  });
  it("settles then confirms in one click under the stop table when the same user holds both permissions", async () => {
    api.mockResolvedValue({});
    const done = { ...stop, result: "GIAO_DU" as const, resultLabel: "Giao đủ", due: "200000", cash: "200000", cashAccountId: 1 };
    const returned = { ...detail, status: "RETURNED" as const, stops: [done], totals: { ...detail.totals, expected: "200000", cash: "200000" } };
    render(<TripResultsView {...props} detail={returned} perms={{ canSettle: true, canConfirm: true }} params={params({ detail: "1" })} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Đối soát và xác nhận đã nhận tiền" })[0]);
    await waitFor(() => expect(api).toHaveBeenCalledWith("/api/trips/1/confirm", expect.objectContaining({ json: { cashAccountId: null, transferAccountId: null } })));
    expect(api).toHaveBeenCalledWith("/api/trips/1/settle", expect.anything());
  });
  it("hides the settle panel without settle/confirm permission", () => {
    render(<TripResultsView {...props} detail={{ ...detail, status: "RETURNED" }} perms={{ canSettle: false, canConfirm: false }} params={params({ detail: "1" })} />);
    expect(screen.queryByRole("button", { name: /Đối soát|Xác nhận đã nhận/ })).not.toBeInTheDocument();
  });
});
