// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PartnerDetail } from "@/components/partners/PartnerDetail";
import { PartnerNewForm } from "@/components/partners/PartnerNewForm";
import type { PartnerActivityDTO } from "@/server/partners/activity";
import type { PartnerDTO } from "@/server/partners/queries";

const apiFetch = vi.fn(), replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }), usePathname: () => "/sales/customers/new", useSearchParams: () => new URLSearchParams(search) }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));
vi.mock("@/lib/confirm-store", () => ({ confirm: async () => true }));
beforeEach(() => { apiFetch.mockReset(); replace.mockReset(); search = ""; });
afterEach(cleanup);

const groups = [{ value: 1, label: "Khách lẻ" }];
const tab = (name: RegExp) => screen.getAllByRole("tab", { name })[0]!;

describe("PartnerNewForm — tab dọc", () => {
  it("khách hàng: Thông tin cơ bản · Công nợ · Lịch sử mua hàng (khóa) · Báo giá & đơn hàng (khóa)", () => {
    render(<PartnerNewForm kind="customer" groups={groups} owners={[]} canPickOwner={false} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent).slice(0, 4)).toEqual(["Thông tin cơ bản", "Công nợ", "Lịch sử mua hàng", "Báo giá & đơn hàng"]);
    expect(tab(/Lịch sử mua hàng/)).toBeDisabled(); expect(tab(/Lịch sử mua hàng/)).toHaveAttribute("title", "Lưu trước để xem");
    expect(screen.getByLabelText(/^Tên/)).toBeVisible();
    expect(screen.getByLabelText(/Hạn mức nợ/, { selector: "input" })).toBeVisible();
  });
  it("nhà cung cấp: có tab Lịch sử nhập hàng, không có tab đơn bán", () => {
    render(<PartnerNewForm kind="supplier" groups={groups} owners={[]} canPickOwner={false} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent).slice(0, 3)).toEqual(["Thông tin cơ bản", "Công nợ", "Lịch sử nhập hàng"]);
    expect(screen.queryAllByRole("tab", { name: /Báo giá/ })).toHaveLength(0);
  });
  it("đang ở tab Công nợ mà thiếu Tên ⇒ tab Thông tin cơ bản có chấm lỗi và tự nhảy về đó; dữ liệu Công nợ không mất", async () => {
    render(<PartnerNewForm kind="customer" groups={groups} owners={[]} canPickOwner={false} />);
    await userEvent.click(tab(/Công nợ/));
    await userEvent.clear(screen.getByLabelText(/Hạn mức nợ/, { selector: "input" })); await userEvent.type(screen.getByLabelText(/Hạn mức nợ/, { selector: "input" }), "5000000");
    await userEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await waitFor(() => expect(screen.getByLabelText(/^Tên/)).toBeVisible());
    expect(screen.getAllByRole("img", { name: "Tab Thông tin cơ bản có lỗi" }).length).toBeGreaterThan(0);
    expect(apiFetch).not.toHaveBeenCalled();
    await userEvent.click(tab(/Công nợ/));
    expect(screen.getByLabelText(/Hạn mức nợ/, { selector: "input" })).toHaveValue(5000000);
  });
});

const partner = (over: Partial<PartnerDTO> = {}): PartnerDTO => ({ id: 7, code: "KH000007", name: "Khách Đạt", groupId: 1, groupName: "Khách lẻ", isCustomer: true, isSupplier: false, phone: null, address: null, note: null, debtLimit: "1000000", allowCredit: true, ownerUserId: null, ownerName: null, isActive: true, mergedIntoId: null, ...over } as PartnerDTO);
const activity = (over: Partial<PartnerActivityDTO> = {}): PartnerActivityDTO => ({
  debt: { balance: "250000", opening: "0", discountBalance: "10000", total: 1, entries: [{ id: 1, at: "2026-09-15T03:00:00.000Z", docLabel: "Phiếu giao", docCode: "PG000001", docHref: "/sales/delivery-notes/1", debit: "250000", credit: "0", running: "250000" }] },
  history: [{ id: 3, code: "DH000003", at: "2026-09-10T03:00:00.000Z", total: "100000", payment: "Đã thu" }],
  pipeline: { quotes: [{ id: 1, code: "BG000001", at: "2026-09-12T03:00:00.000Z", status: "Nháp" }], orders: [{ id: 4, code: "DH000004", at: "2026-09-14T03:00:00.000Z", delivery: "READY", total: null }] },
  purchases: null, ...over,
});
const detail = (p: PartnerDTO, a: PartnerActivityDTO, kind: "customer" | "supplier" = "customer") => render(<PartnerDetail partner={p} kind={kind} groups={groups} owners={[]} history={[]} activity={a} canManage canAssign mergedInto={null} />);

describe("PartnerDetail — tab bổ sung", () => {
  it("khách hàng: Thông tin cơ bản · Công nợ · Lịch sử mua hàng · Báo giá & đơn hàng · Nhật ký; tab Công nợ có số dư + sổ gần nhất", async () => {
    search = "tab=debt";
    detail(partner(), activity());
    expect(screen.getAllByRole("button").map((b) => b.textContent ?? "").filter((t) => /Thông tin cơ bản|Công nợ|Lịch sử mua hàng|Báo giá & đơn hàng|Nhật ký/.test(t)).length).toBeGreaterThanOrEqual(5);
    expect(await screen.findByText("Số dư công nợ")).toBeInTheDocument();
    expect(screen.getByText(/Phiếu giao PG000001/)).toBeInTheDocument();
  });
  it("không có quyền xem công nợ ⇒ báo rõ, không lộ số", async () => {
    search = "tab=debt";
    detail(partner(), activity({ debt: null }));
    expect(await screen.findByText(/không có quyền xem công nợ/)).toBeInTheDocument();
  });
  it("nhà cung cấp thuần: có Lịch sử nhập hàng, không có tab mua hàng/báo giá", async () => {
    search = "tab=supply";
    detail(partner({ isCustomer: false, isSupplier: true }), activity({ history: null, pipeline: null, purchases: [{ id: 9, code: "PN000009", at: "2026-09-11T03:00:00.000Z", total: "700000" }] }), "supplier");
    expect(screen.queryAllByRole("button", { name: /Lịch sử mua hàng|Báo giá/ })).toHaveLength(0);
    expect(await screen.findByText("PN000009")).toBeInTheDocument();
  });
});
