// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CostReferenceInfo, referencePerBase } from "@/components/sales/CostReferenceInfo";
import type { SalePricingDTO } from "@/server/sales/pricing";
afterEach(cleanup);
const dto = (value: object) => ({ productId: 1, baseUnit: "md", units: [], lastSalePrice: null, lastSalePriceForPartner: false, ...value }) as SalePricingDTO;
it("shows a compact source-labelled production cost converted to the selected unit", () => {
  render(<CostReferenceInfo dto={dto({ costReference: { primary: { kind: "PRODUCTION", perBase: "156660", code: "SX000003", at: "2026-10-16", href: "/production/orders/3" }, alternatives: [] } })} divisor={2} unit="m²" />);
  expect(screen.getByText("78.330 ₫/m²")).toBeVisible();
  expect(screen.getByRole("link", { name: "SX000003" })).toHaveAttribute("href", "/production/orders/3");
  expect(screen.queryByText("Chi tiết giá vốn")).toBeNull();
});
it("keeps BOM material details collapsed and never falls back to the raw product price", () => {
  const input = dto({ lastPurchasePrice: "100", costReference: { primary: { kind: "BOM", perBase: null, code: "Định mức v1", at: "2026-09-01" }, alternatives: [], message: "Thiếu giá keo", materials: [{ code: "KEO", name: "Keo", qty: "1", unit: "kg", price: null, amount: null, at: null }] } });
  render(<CostReferenceInfo dto={input} unit="md" />);
  expect(referencePerBase(input)).toBeNull();
  expect(screen.getByText("Chưa đủ dữ liệu")).toBeVisible();
  expect(screen.getByText("Thiếu giá keo")).toBeVisible();
  expect(screen.getByText("Chi tiết giá vốn").closest("details")).not.toHaveAttribute("open");
  expect(screen.queryByText("100 ₫/md")).toBeNull();
});
it("hides the cost section when the API provides no authorized cost data", () => {
  const { container } = render(<CostReferenceInfo dto={dto({})} unit="md" />);
  expect(container).toBeEmptyDOMElement();
});
