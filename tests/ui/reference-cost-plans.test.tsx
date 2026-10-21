// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReferenceCostPlans } from "@/components/products/ReferenceCostPlans";
import { ConfirmHost } from "@/components/ui";

const fetch = vi.fn();
vi.mock("@/lib/api-fetch", () => ({ apiFetch: (...args: unknown[]) => fetch(...args) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn() } }));
beforeEach(() => { fetch.mockReset(); fetch.mockImplementation(async (url: string) => url.startsWith("/api/reference-cost-materials") ? [{ value: 7, label: "Tôn đỏ đầu vào" }] : []); });
afterEach(cleanup);
const types = [{ value: 3, label: "Tôn xốp" }];
async function pick(name: string) {
  await userEvent.click(screen.getByRole("combobox", { name }));
  await userEvent.click((await within(await screen.findByRole("listbox")).findAllByRole("option"))[0]!);
}
it("saves finished-width fixed price separately from the per-meter processing fee", async () => {
  render(<ReferenceCostPlans productId={2} types={types} canManage canDefault />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Tôn xốp" })); await pick("Mã tôn đầu vào");
  await userEvent.type(screen.getByLabelText(/Giá tôn \(đ\/m²\)/), "44322");
  await userEvent.type(screen.getByLabelText(/Phí gia công \(đ\/m dài\)/), "2000");
  await userEvent.click(screen.getByRole("button", { name: "Lưu phiên bản dự toán" }));
  await waitFor(() => expect(fetch.mock.calls.some(c => c[1]?.method === "POST")).toBe(true));
  expect(fetch.mock.calls.find(c => c[1]?.method === "POST")![1].json).toMatchObject({ scope: "PRODUCT", processingTypeIds: [3], tonProductId: 7, fixedPricePerM2: 44322, feePerMeter: 2000 });
});
it("allows an explicit zero default fee and does not expose product price fields in default scope", async () => {
  render(<ReferenceCostPlans productId={2} types={types} canManage={false} canDefault />);
  await userEvent.click(screen.getByRole("checkbox", { name: "Tôn xốp" }));
  expect(screen.queryByRole("combobox", { name: "Mã tôn đầu vào" })).toBeNull();
  await userEvent.type(screen.getByLabelText(/Phí gia công/), "0");
  await userEvent.click(screen.getByRole("button", { name: "Lưu phiên bản dự toán" }));
  await waitFor(() => expect(fetch.mock.calls.some(c => c[1]?.method === "POST")).toBe(true));
  expect(fetch.mock.calls.find(c => c[1]?.method === "POST")![1].json).toMatchObject({ scope: "TYPE", tonProductId: null, fixedPricePerM2: null, feePerMeter: 0 });
});
const plan = (over: Record<string, unknown> = {}) => ({ id: 9, used: false, productId: 2, processingTypeId: 3, typeName: "Tôn xốp", validFrom: "2099-01-01", ton: { value: 7, label: "Tôn đỏ" }, fixedPricePerM2: "44322", tonQtyPerMeter: "1", feePerMeter: "2000", note: "ghi chú", ...over });
it("template button fills the form; unused plan can be deleted after confirm, used plan has no delete", async () => {
  let rows = [plan(), plan({ id: 8, used: true, validFrom: "2020-01-01" })];
  fetch.mockImplementation(async (url: string, init?: { method?: string }) => { if (init?.method === "DELETE") { rows = rows.filter(r => r.id !== 9); return { ok: true }; } return url.startsWith("/api/products") ? rows : []; });
  render(<><ConfirmHost /><ReferenceCostPlans productId={2} types={types} canManage canDefault /></>);
  await screen.findAllByRole("button", { name: "Dùng làm mẫu" });
  expect(screen.getAllByRole("button", { name: "Xoá" })).toHaveLength(1);
  expect(screen.getByText("Đã dùng trên đơn")).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole("button", { name: "Dùng làm mẫu" })[0]!);
  expect(screen.getByLabelText(/Phí gia công \(đ\/m dài\)/)).toHaveValue("2.000");
  await userEvent.click(screen.getByRole("button", { name: "Xoá" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Xoá" }));
  await waitFor(() => expect(fetch.mock.calls.some(c => c[1]?.method === "DELETE" && String(c[0]).endsWith("/reference-cost-plans/9"))).toBe(true));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Xoá" })).toBeNull());
});
it("read-only users cannot submit configuration", async () => {
  render(<ReferenceCostPlans productId={2} types={types} canManage={false} canDefault={false} />);
  await screen.findByText(/Chưa có cấu hình/);
  expect(screen.queryByRole("button", { name: "Lưu phiên bản dự toán" })).toBeNull();
});
