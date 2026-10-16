// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BomNewForm, type BomFormDefaults } from "@/components/bom/BomNewForm";
import { ApiError } from "@/lib/api-fetch";

const replace = vi.fn();
const apiFetch = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }), usePathname: () => "/production/bom/new", useSearchParams: () => new URLSearchParams("") }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

beforeEach(() => { replace.mockReset(); apiFetch.mockReset(); });
afterEach(cleanup);

const mat = (id: number, code: string) => ({ value: id, label: `${code} — Vật liệu ${code}`, baseUnit: "kg" });
const prefilled = (over: Partial<BomFormDefaults> = {}): BomFormDefaults => ({
  product: { value: 10, label: "TP01 — Tôn xốp" },
  processingType: { value: 3, label: "Dán xốp" },
  lines: [{ material: mat(21, "NVL1"), qtyPerUnit: 1.25 }, { material: mat(22, "NVL2"), qtyPerUnit: 0.5 }],
  hasVersions: true,
  ...over,
});
const submit = () => userEvent.click(screen.getByRole("button", { name: "Lưu phiên bản" }));

describe("BomNewForm (/production/bom/new)", () => {
  it("applies one material list to multiple products and processing types in one batch", async () => {
    apiFetch.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/bom/options/products?role=target")) return [{ value: 11, label: "TP02 — Tôn thứ hai" }];
      if (url === "/api/bom/options/processing-types") return [{ value: 4, label: "Cán sóng" }];
      if (url === "/api/bom/batch") return { count: 4 };
      return [];
    });
    render(<BomNewForm today="2026-09-29" defaults={prefilled()} />);
    await userEvent.click(screen.getByRole("button", { name: "Chọn thêm thành phẩm" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "TP02 — Tôn thứ hai" }));
    await userEvent.click(screen.getByRole("button", { name: "Thêm 1 sản phẩm" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Thêm kiểu gia công" }));
    await userEvent.click(await screen.findByRole("option", { name: /Cán sóng/ }));
    expect(screen.getByRole("status")).toHaveTextContent("2 thành phẩm × 2 kiểu gia công = 4 định mức");
    await submit();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/api/bom/batch", expect.objectContaining({ method: "POST", json: expect.objectContaining({ productIds: [10, 11], processingTypeIds: [3, 4], lines: expect.arrayContaining([expect.objectContaining({ materialProductId: 21, qtyPerUnit: 1.25 })]) }), idempotencyKey: expect.any(String) })));
    expect(replace).toHaveBeenCalledWith("/production/bom");
  });
  it("form trống → không gọi API", async () => {
    render(<BomNewForm today="2026-09-29" defaults={{ product: null, processingType: null, lines: [], hasVersions: false }} />);
    await submit();
    await waitFor(() => expect(document.querySelectorAll('[aria-invalid="true"]').length).toBeGreaterThan(0));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("định mức 0 → báo lỗi tại ô, không POST", async () => {
    render(<BomNewForm today="2026-09-29" defaults={prefilled()} />);
    const qty = screen.getByLabelText("Định mức dòng 1");
    await userEvent.clear(qty);
    await userEvent.type(qty, "0");
    await submit();
    expect(await screen.findByText("Định mức phải lớn hơn 0.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("nguyên vật liệu trùng → báo lỗi, không POST", async () => {
    const dup: BomFormDefaults = prefilled({ lines: [{ material: mat(21, "NVL1"), qtyPerUnit: 1 }, { material: mat(21, "NVL1"), qtyPerUnit: 2 }] });
    render(<BomNewForm today="2026-09-29" defaults={dup} />);
    await submit();
    expect(await screen.findByText("Nguyên vật liệu bị trùng.")).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("hợp lệ → POST /api/bom kèm Idempotency-Key, rồi mở tab phiên bản của BOM", async () => {
    apiFetch.mockResolvedValueOnce({ bomId: 7, versionId: 9, versionNo: 2 });
    render(<BomNewForm today="2026-09-29" defaults={prefilled()} />);
    await submit();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/production/bom/7?tab=versions"));
    const [url, init] = apiFetch.mock.calls[0]!;
    expect(url).toBe("/api/bom");
    expect(init).toMatchObject({
      method: "POST",
      json: { productId: 10, processingTypeId: 3, validFrom: "2026-09-29", lines: [{ materialProductId: 21, qtyPerUnit: 1.25 }, { materialProductId: 22, qtyPerUnit: 0.5 }] },
    });
    expect(init.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("409 trùng ngày hiệu lực → lỗi tại ô ngày, giữ form, không chuyển trang", async () => {
    apiFetch.mockRejectedValueOnce(new ApiError(409, "Đã có phiên bản định mức cùng ngày hiệu lực.", "CONFLICT", { validFrom: "Đã có phiên bản cùng ngày hiệu lực." }));
    render(<BomNewForm today="2026-09-29" defaults={prefilled()} />);
    await submit();
    expect(await screen.findByText("Đã có phiên bản cùng ngày hiệu lực.")).toBeInTheDocument();
    expect(screen.getByLabelText("Định mức dòng 1")).toHaveValue("1,25");
    expect(replace).not.toHaveBeenCalled();
  });

  it("BOM đã có phiên bản: ô ngày chặn quá khứ; BOM mới: không chặn", () => {
    const { unmount } = render(<BomNewForm today="2026-09-29" defaults={prefilled({ hasVersions: true })} />);
    expect(screen.getByLabelText(/Hiệu lực từ ngày/)).toHaveAttribute("min", "2026-09-29");
    unmount();
    render(<BomNewForm today="2026-09-29" defaults={prefilled({ hasVersions: false })} />);
    expect(screen.getByLabelText(/Hiệu lực từ ngày/)).not.toHaveAttribute("min");
  });
});
