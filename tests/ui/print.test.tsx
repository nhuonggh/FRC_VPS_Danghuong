// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PrintButton } from "@/components/print/PrintButton";
import { PRINT_DOCS, canPrintDoc } from "@/server/print/types";

afterEach(cleanup);

describe("PrintButton", () => {
  it.each(PRINT_DOCS.map((d) => d.docType))("%s mở mẫu HTML trực tiếp ở tab mới", (docType) => {
    render(<PrintButton docType={docType} docId={12} label="In phiếu" />);
    const link = screen.getByRole("link", { name: "In phiếu" });
    expect(link).toHaveAttribute("href", `/api/print/${docType}/12/html`); // mọi phiếu mở màn xem trước, không tự in
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
  it("canPrintDoc: cần print.use + quyền xem giá/tiền của loại chứng từ; loại lạ không in được", () => {
    expect(canPrintDoc(new Set(["print.use", "sale_price.view"]), "SALE_INVOICE")).toBe(true);
    expect(canPrintDoc(new Set(["sale_price.view"]), "SALE_INVOICE")).toBe(false);
    expect(canPrintDoc(new Set(["print.use"]), "SALE_INVOICE")).toBe(false);
    expect(canPrintDoc(new Set(["print.use", "production.manage"]), "PRODUCTION_ORDER")).toBe(true);
    expect(canPrintDoc(new Set(["print.use", "stocktake.manage"]), "STOCKTAKE")).toBe(true);
    expect(canPrintDoc(new Set(["print.use", "return.manage"]), "GOODS_RETURN")).toBe(true);
    expect(canPrintDoc(new Set(["print.use"]), "NOPE")).toBe(false);
  });
});
