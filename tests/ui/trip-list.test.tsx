// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TripList } from "@/components/trips/TripList";
import { parseListParams } from "@/lib/query-params";
import { TRIP_FILTER_KEYS, type TripRowDTO, type TripStatsDTO } from "@/server/trips/queries";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const stats: TripStatsDTO = { active: 5, returned: 2, settled: 1, confirmed: 1, all: 10, counts: { PLANNED: 3, ON_ROAD: 2, RETURNED: 2, SETTLED: 1, CONFIRMED: 1, CANCELLED: 1 } };
const row: TripRowDTO = { id: 1, code: "CH000001", date: "2026-10-16", status: "RETURNED", statusLabel: "Đã về (đủ kết quả)", routeName: "Tuyến A", vehiclePlate: "51C-12345", driverName: "Nguyễn Văn An", assistantName: null, stops: 2, done: 2, expected: "200000", collected: "150000", cash: "150000", transfer: "0", collectionStatus: "unpaid" };
const props = { title: "Danh sách chuyến", base: "/delivery/trips", rows: [row], total: 1, stats, vehicles: [], customers: [{ id: 1, name: "Khách Đạt" }, { id: 2, name: "Khách Bình" }], routes: [{ id: 3, name: "Tuyến A" }, { id: 4, name: "Tuyến B" }], canCreate: true };
describe("trip list tabs and filters", () => {
  it("status tabs show counts before labels and keep other filters while resetting the page", () => {
    render(<TripList {...props} params={parseListParams({ customer: "1,2", route: "3,4", collection: "unpaid", vehicle: "5", timePreset: "today", page: "3" }, TRIP_FILTER_KEYS)} />);
    const nav = screen.getByRole("navigation", { name: "Trạng thái chuyến" });
    expect(within(nav).getAllByRole("link")).toHaveLength(7);
    const tab = within(nav).getByRole("link", { name: "2 Đã về (đủ kết quả)" });
    const url = new URL(tab.getAttribute("href")!, "https://example.test");
    expect(url.searchParams.get("status")).toBe("RETURNED");
    expect(url.searchParams.get("customer")).toBe("1,2");
    expect(url.searchParams.get("route")).toBe("3,4");
    expect(url.searchParams.get("collection")).toBe("unpaid");
    expect(url.searchParams.get("timePreset")).toBe("today");
    expect(url.searchParams.has("page")).toBe(false);
    expect(tab.firstElementChild).toHaveTextContent("2");
    expect(screen.getAllByText("Chưa thu")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "CH000001" })).toHaveLength(2);
  });
  it("customer multi-selection supports search and consecutive selections without dropping earlier choices", async () => {
    render(<TripList {...props} params={parseListParams({ route: "3" }, TRIP_FILTER_KEYS)} />);
    await userEvent.click(screen.getByRole("button", { name: /^Khách hàng/ }));
    const input = screen.getByRole("searchbox", { name: "Tìm khách hàng" });
    await userEvent.type(input, "dat");
    expect(screen.getByRole("menuitemcheckbox", { name: "Khách Đạt" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Khách Bình" })).not.toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Khách Đạt" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Khách Bình" }));
    const url = new URL(push.mock.calls.at(-1)![0], "https://example.test");
    expect(url.searchParams.get("customer")).toBe("1,2");
    expect(url.searchParams.get("route")).toBe("3");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
  it("routes allow multiple selections and the collection filter has both requested options", async () => {
    render(<TripList {...props} params={parseListParams({ customer: "1" }, TRIP_FILTER_KEYS)} />);
    await userEvent.click(screen.getByRole("button", { name: /^Tuyến/ }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Tuyến A" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Tuyến B" }));
    expect(push.mock.calls.at(-1)![0]).toContain("route=3%2C4");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Trạng thái phải thu" }));
    expect(screen.getByRole("menuitemcheckbox", { name: "Đã thu" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Chưa thu" }));
    expect(push.mock.calls.at(-1)![0]).toContain("collection=unpaid");
  });
  it("fixed workflow lists do not expose tabs that can broaden their status scope", () => {
    render(<TripList {...props} fixedStatus params={parseListParams({})} />);
    expect(screen.queryByRole("navigation", { name: "Trạng thái chuyến" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Khách hàng/ })).not.toBeInTheDocument();
  });
});
