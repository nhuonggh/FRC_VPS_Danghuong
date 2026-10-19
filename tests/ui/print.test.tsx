// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrintButton } from "@/components/print/PrintButton";
import { canPrintDoc } from "@/server/print/types";

const apiFetch = vi.fn(); const open = vi.fn();
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));
beforeEach(() => { apiFetch.mockReset(); open.mockReset(); vi.stubGlobal("open", open); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("PrintButton", () => {
  it("bấm In: chỉ nút này bận (không khoá màn hình), xong hiện liên kết mở bản in + mở tab mới; bấm lại thành 'In lại'", async () => {
    let done: (v: unknown) => void = () => undefined;
    apiFetch.mockReturnValueOnce(new Promise((r) => { done = r; }));
    render(<><PrintButton docType="QUOTE" docId={5} label="In báo giá" /><button type="button">Nút khác</button></>);
    await userEvent.click(screen.getByRole("button", { name: /In báo giá/ }));
    expect(screen.getByRole("button", { name: /Đang tạo bản in/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Nút khác" })).toBeEnabled();
    done({ url: "https://docs.google.com/document/d/F1/edit", name: "HoaDon_DH1", replaced: false });
    const link = await screen.findByRole("link", { name: /Mở bản in/ });
    expect(link).toHaveAttribute("href", "https://docs.google.com/document/d/F1/edit"); expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(apiFetch).toHaveBeenCalledWith("/api/print/QUOTE/5", { method: "POST" });
    expect(open).toHaveBeenCalledWith("https://docs.google.com/document/d/F1/edit", "_blank", "noopener,noreferrer");
    expect(screen.getByRole("button", { name: /In lại/ })).toBeEnabled();
  });
  it.each(["SALE_INVOICE", "DELIVERY_NOTE", "PURCHASE_RECEIPT"])("%s mở mẫu HTML trực tiếp, không gọi webhook", (docType) => {
    render(<PrintButton docType={docType} docId={12} label="In phiếu" />);
    expect(screen.getByRole("link", { name: "In phiếu" })).toHaveAttribute("href", `/api/print/${docType}/12/html?auto=1`);
    expect(screen.getByRole("link")).toHaveAttribute("target", "_blank");
    expect(apiFetch).not.toHaveBeenCalled();
  });
  it("lỗi (chưa cấu hình mẫu / hết 12 giây) hiện ngay cạnh nút, nút dùng lại được", async () => {
    apiFetch.mockRejectedValueOnce(new Error("Chưa bật mẫu in cho “Báo giá”."));
    render(<PrintButton docType="QUOTE" docId={2} />);
    await userEvent.click(screen.getByRole("button", { name: /In/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Chưa bật mẫu in");
    await waitFor(() => expect(screen.getByRole("button", { name: /In/ })).toBeEnabled());
  });
  it("canPrintDoc: cần print.use + quyền xem giá/tiền của loại chứng từ; loại chưa hỗ trợ không in được", () => {
    expect(canPrintDoc(new Set(["print.use", "sale_price.view"]), "SALE_INVOICE")).toBe(true);
    expect(canPrintDoc(new Set(["sale_price.view"]), "SALE_INVOICE")).toBe(false);
    expect(canPrintDoc(new Set(["print.use"]), "SALE_INVOICE")).toBe(false);
    expect(canPrintDoc(new Set(["print.use", "production.manage"]), "PRODUCTION_ORDER")).toBe(false);
    expect(canPrintDoc(new Set(["print.use"]), "NOPE")).toBe(false);
  });
});
