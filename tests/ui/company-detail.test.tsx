// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanyDetail } from "@/components/company/CompanyDetail";
import type { CompanyDTO, PrintTemplateDTO } from "@/server/company/queries";

const apiFetch = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/system/company",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

beforeEach(() => { apiFetch.mockReset(); search = ""; });
afterEach(cleanup);

const company: CompanyDTO = {
  name: "Xưởng tôn Đặng Hương", address: "HCM", phone: "0912345678", taxCode: "0312345678", logo: "",
  bank: { bankName: "VCB", accountNo: "123", accountHolder: "DANG HUONG", branch: "" }, version: 1700000000000,
};
const tpl: PrintTemplateDTO = {
  id: 5, docType: "SALE_INVOICE", name: "Hoá đơn bán", webhookUrl: "https://script.google.com/macros/s/AKfy/exec", hasSecret: true, isActive: true,
  title: "HOÁ ĐƠN", signerName: "", phone: "", qrImage: "", showCompanyInfo: true, footerNote: "",
};

describe("CompanyDetail (/system/company)", () => {
  it("tab Công ty hiển thị thông tin và ngân hàng", () => {
    render(<CompanyDetail company={company} templates={[tpl]} />);
    expect(screen.getByText("0312345678", { selector: "dd, span, div" })).toBeInTheDocument();
    expect(screen.getByText("VCB")).toBeInTheDocument();
  });

  it("sửa thông tin công ty gửi PATCH kèm version để chống ghi đè mù", async () => {
    apiFetch.mockResolvedValueOnce({ version: 1 });
    render(<CompanyDetail company={company} templates={[]} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa thông tin công ty" }));
    const name = screen.getByLabelText(/Tên công ty/);
    await userEvent.clear(name);
    await userEvent.type(name, "Đặng Hương Mới");
    await userEvent.click(screen.getByRole("button", { name: /Lưu/ }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(apiFetch.mock.calls[0]![0]).toBe("/api/company");
    expect(apiFetch.mock.calls[0]![1]).toMatchObject({ method: "PATCH", json: { section: "info", version: company.version, value: { name: "Đặng Hương Mới" } } });
  });

  it("mẫu in: view không lộ secret, chỉ 'Đã đặt'; không có nút thử webhook", () => {
    search = "tab=templates";
    render(<CompanyDetail company={company} templates={[tpl]} />);
    expect(screen.getByText("Đã đặt (không hiển thị)")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/secretCiphertext|v1\./);
    expect(screen.queryByRole("button", { name: /thử|test/i })).toBeNull();
  });

  it("sửa mẫu in: mặc định GIỮ secret (không gửi secret), thay cần nhập ≥ 8 ký tự", async () => {
    search = "tab=templates";
    apiFetch.mockResolvedValue({ ok: true });
    render(<CompanyDetail company={company} templates={[tpl]} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa mẫu Hoá đơn bán" }));
    expect(screen.getByRole("radio", { name: "Giữ secret hiện tại" })).toBeChecked();
    expect(screen.queryByLabelText("Secret mới")).toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: "Thay bằng secret mới" }));
    await userEvent.type(screen.getByLabelText("Secret mới"), "short");
    await userEvent.click(screen.getByRole("button", { name: /Lưu/ }));
    expect(await screen.findByText("Secret mới tối thiểu 8 ký tự.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Secret mới"), "-du-dai-roi");
    await userEvent.click(screen.getByRole("button", { name: /Lưu/ }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(apiFetch.mock.calls[0]![0]).toBe("/api/company/templates/5");
    expect(apiFetch.mock.calls[0]![1].json).toMatchObject({ secretAction: "replace", secret: "short-du-dai-roi" });
  });

  it("nút Xoá secret chỉ có khi mẫu đã có secret", async () => {
    search = "tab=templates";
    render(<CompanyDetail company={company} templates={[{ ...tpl, hasSecret: false }, { ...tpl, id: 6, name: "Phiếu kho", hasSecret: true }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Chỉnh sửa mẫu Hoá đơn bán" }));
    expect(screen.queryByRole("radio", { name: "Xoá secret" })).toBeNull();
  });
});
