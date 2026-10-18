// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReturnByOrderWorkspace } from "@/components/returns/ReturnByOrderWorkspace";
import type { ReturnableOrderDTO } from "@/server/returns/queries";

const { push, apiFetch, leave } = vi.hoisted(() => ({ push: vi.fn(), apiFetch: vi.fn(), leave: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/returns/by-order/new", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch }));
vi.mock("@/lib/dirty-guard", () => ({ confirmLeaveIfDirty: leave, registerDirtyGuard: () => () => {} }));
beforeEach(() => { vi.clearAllMocks(); leave.mockResolvedValue(true); });
afterEach(cleanup);
const customer = { value: 7, label: "KH007 — Khách An" };
const order: ReturnableOrderDTO = { id: 12, code: "DH000012", partnerId: 7, partnerCode: "KH007", partnerName: "Khách An", orderDate: new Date("2026-10-01"), partnerIsRetail: false, undelivered: false, lines: [{ id: 5, productCode: "SP01", productName: "Sản phẩm", unit: "cái", ordered: "4", delivered: "4", returned: "0", remaining: "4", returnable: true, processingTypeName: null }] };
const props = { customer, orders: [{ id: 12, code: "DH000012", partnerName: "Khách An", orderDate: new Date("2026-10-01") }], today: "2026-10-18", undelivered: false };
it("shows customer and order selection together with the return lines", () => {
  render(<ReturnByOrderWorkspace {...props} order={order} />);
  expect(screen.getByRole("combobox", { name: "Khách hàng" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Đơn hàng" })).toBeInTheDocument();
  expect(screen.getByLabelText("SL trả dòng 1")).toBeInTheDocument();
});
it("lists the customer's orders and selects within the same route", async () => {
  render(<ReturnByOrderWorkspace {...props} order={null} />);
  await userEvent.click(screen.getByRole("button", { name: /DH000012/ }));
  expect(push).toHaveBeenLastCalledWith("/returns/by-order/new?partnerId=7&orderId=12");
});
it("changing customer clears the selected order, while declining discard keeps it", async () => {
  apiFetch.mockResolvedValue([{ value: 8, label: "KH008 — Khách Bình" }]);
  render(<ReturnByOrderWorkspace {...props} order={order} />);
  await userEvent.click(screen.getByRole("combobox", { name: "Khách hàng" }));
  const option = await screen.findByRole("option", { name: "KH008 — Khách Bình" });
  leave.mockResolvedValueOnce(false);
  await userEvent.click(option);
  expect(push).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("combobox", { name: "Khách hàng" }));
  await userEvent.click(await screen.findByRole("option", { name: "KH008 — Khách Bình" }));
  await waitFor(() => expect(push).toHaveBeenLastCalledWith("/returns/by-order/new?partnerId=8"));
});
