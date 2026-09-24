// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "@/components/ui/Badge";

afterEach(cleanup);

describe("Badge", () => {
  it.each([
    ["info", "text-info", "bg-info-soft"],
    ["success", "text-success", "bg-success-soft"],
    ["warning", "text-warning", "bg-warning-soft"],
    ["tertiary", "text-tertiary", "bg-tertiary-soft"],
    ["danger", "text-danger", "bg-danger-soft"],
    ["neutral", "text-fg-secondary", "bg-hover"],
  ] as const)("tone %s → chữ %s trên nền %s (pill)", (tone, text, bg) => {
    render(<Badge tone={tone}>Nhãn</Badge>);
    const el = screen.getByText("Nhãn");
    expect(el.className).toContain(text);
    expect(el.className).toContain(bg);
    expect(el.className).toContain("rounded-full");
  });

  it("mặc định neutral", () => {
    render(<Badge>Nháp</Badge>);
    expect(screen.getByText("Nháp").className).toContain("bg-hover");
  });
});
