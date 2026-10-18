// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OperationalStats } from "@/components/ui/OperationalStats";
afterEach(cleanup);

it("preserves fractional stock quantities and warns about negative closing stock", () => {
  render(<OperationalStats kind="ledger" unit="kg" data={{ opening: "1.125", incoming: "0.5", outgoing: "2", closing: "-0.375" }} />);
  expect(screen.getByText("Tồn đầu (kg)")).toBeInTheDocument();
  expect(screen.getByText("1,125")).toBeInTheDocument();
  expect(screen.getByText("-0,375")).toHaveClass("text-danger");
});
it("shows movement counts without exposing stock values when none are supplied", () => {
  render(<OperationalStats kind="xnt" data={{ total: 30, incoming: 4, outgoing: 3, inStock: 20 }} />);
  expect(screen.getByText("30")).toBeInTheDocument();
  expect(screen.queryByText("Giá trị tồn cuối")).not.toBeInTheDocument();
});
it("formats authorized inventory values as currency", () => {
  render(<OperationalStats kind="xnt" data={{}} values={{ openingValue: "100000", inValue: "20000", outValue: "30000", closingValue: "90000" }} />);
  expect(screen.getByText("90.000 ₫")).toBeInTheDocument();
});
