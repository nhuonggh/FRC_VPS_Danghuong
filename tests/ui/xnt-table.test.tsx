// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { XntTable } from "@/components/inventory/XntTable";
import type { XntRow, XntTotals } from "@/server/inventory-reports/xnt";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/inventory/xnt" }));

afterEach(cleanup);

const row: XntRow = { productId: 1, code: "TL045", name: "Tôn lạnh", baseUnit: "md", opening: "0", inQty: "1250.5", outQty: "120", closing: "1130.5" };
const totals: XntTotals = { opening: "0", inQty: "1250.5", outQty: "120", closing: "1130.5" };

describe("XntTable", () => {
  it("hiển thị bốn cột số lượng và tổng cộng", () => {
    render(<XntTable rows={[row]} totals={totals} />);
    for (const label of ["Tồn đầu", "Nhập", "Xuất", "Tồn cuối"]) expect(screen.getByRole("columnheader", { name: label })).toBeInTheDocument();
    expect(screen.getByText(/Tổng cộng:/)).toHaveTextContent("1.130,5");
  });

  it("chỉ hiện đủ bốn cột giá trị khi server đã cấp dữ liệu cost.view", () => {
    render(<XntTable rows={[{ ...row, openingValue: "0", inValue: "3100000", outValue: "2440000", closingValue: "660000" }]} totals={{ ...totals, openingValue: "0", inValue: "3100000", outValue: "2440000", closingValue: "660000" }} />);
    for (const label of ["GT tồn đầu", "GT nhập", "GT xuất", "GT tồn cuối"]) expect(screen.getByRole("columnheader", { name: label })).toBeInTheDocument();
  });
});
