// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReferenceCostPlans } from "@/components/products/ReferenceCostPlans";

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
  await pick("Kiểu gia công dự toán"); await pick("Mã tôn đầu vào");
  await userEvent.type(screen.getByLabelText(/Giá tôn \(đ\/m²\)/), "44322");
  await userEvent.type(screen.getByLabelText(/Phí gia công \(đ\/m dài\)/), "2000");
  await userEvent.click(screen.getByRole("button", { name: "Lưu phiên bản dự toán" }));
  await waitFor(() => expect(fetch.mock.calls.some(c => c[1]?.method === "POST")).toBe(true));
  expect(fetch.mock.calls.find(c => c[1]?.method === "POST")![1].json).toMatchObject({ scope: "PRODUCT", processingTypeId: 3, tonProductId: 7, fixedPricePerM2: 44322, feePerMeter: 2000 });
});
it("allows an explicit zero default fee and does not expose product price fields in default scope", async () => {
  render(<ReferenceCostPlans productId={2} types={types} canManage={false} canDefault />);
  await pick("Kiểu gia công dự toán");
  expect(screen.queryByRole("combobox", { name: "Mã tôn đầu vào" })).toBeNull();
  await userEvent.type(screen.getByLabelText(/Phí gia công/), "0");
  await userEvent.click(screen.getByRole("button", { name: "Lưu phiên bản dự toán" }));
  await waitFor(() => expect(fetch.mock.calls.some(c => c[1]?.method === "POST")).toBe(true));
  expect(fetch.mock.calls.find(c => c[1]?.method === "POST")![1].json).toMatchObject({ scope: "TYPE", tonProductId: null, fixedPricePerM2: null, feePerMeter: 0 });
});
it("read-only users cannot submit configuration", async () => {
  render(<ReferenceCostPlans productId={2} types={types} canManage={false} canDefault={false} />);
  await screen.findByText(/Chưa có cấu hình/);
  expect(screen.queryByRole("button", { name: "Lưu phiên bản dự toán" })).toBeNull();
});
