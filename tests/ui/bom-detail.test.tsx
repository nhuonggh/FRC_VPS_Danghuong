// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BomDetail } from "@/components/bom/BomDetail";
import type { BomDetailDTO, BomVersionDTO } from "@/server/bom";

const refresh = vi.fn();
const apiFetch = vi.fn();
const confirmFn = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }),
  usePathname: () => "/production/bom/1",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api-fetch", async (orig) => ({ ...(await orig<typeof import("@/lib/api-fetch")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));
vi.mock("@/lib/confirm-store", () => ({ confirm: (...a: unknown[]) => confirmFn(...a) }));

beforeEach(() => { refresh.mockReset(); apiFetch.mockReset(); confirmFn.mockReset(); search = ""; });
afterEach(cleanup);

const version = (over: Partial<BomVersionDTO>): BomVersionDTO => ({
  id: 1, versionNo: 1, validFrom: "2026-09-01", status: "ACTIVE", note: null, createdAt: "2026-09-01T03:00:00Z", createdBy: 1, isCurrent: false,
  lines: [{ id: 1, materialProductId: 21, materialCode: "NVL1", materialName: "Tôn cuộn", baseUnit: "kg", qtyPerUnit: "1.25", note: null }],
  ...over,
});
const bom: BomDetailDTO = {
  id: 1, productId: 10, productCode: "TP01", productName: "Tôn xốp", processingTypeId: 3, processingType: "Dán xốp", areaRatio: null,
  versions: [
    version({ id: 2, versionNo: 2, validFrom: "2026-10-01" }), // lên lịch
    version({ id: 1, versionNo: 1, validFrom: "2026-09-01", isCurrent: true }),
  ],
};
const TODAY = "2026-09-29";

describe("BomDetail", () => {
  it("tab Hiện hành hiển thị dòng của phiên bản đang áp dụng", () => {
    render(<BomDetail bom={bom} canManage today={TODAY} />);
    expect(screen.getByText(/Phiên bản v1 — hiệu lực từ 01\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByText("Tôn cuộn")).toBeInTheDocument();
  });

  it("deep link ?tab=versions mở tab Phiên bản, chỉ bản lên lịch có nút Huỷ", () => {
    search = "tab=versions";
    render(<BomDetail bom={bom} canManage today={TODAY} />);
    expect(screen.getAllByRole("region", { name: /Phiên bản/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Huỷ phiên bản v2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Huỷ phiên bản v1" })).toBeNull();
  });

  it("chỉ xem (không bom.manage) → không có nút tạo/huỷ", () => {
    search = "tab=versions";
    render(<BomDetail bom={bom} canManage={false} today={TODAY} />);
    expect(screen.queryByRole("button", { name: /Huỷ phiên bản/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Tạo phiên bản mới" })).toBeNull();
  });

  it("huỷ phiên bản: xác nhận rồi POST; từ chối xác nhận thì không gọi API", async () => {
    search = "tab=versions";
    render(<BomDetail bom={bom} canManage today={TODAY} />);
    confirmFn.mockResolvedValueOnce(false);
    await userEvent.click(screen.getByRole("button", { name: "Huỷ phiên bản v2" }));
    expect(apiFetch).not.toHaveBeenCalled();

    confirmFn.mockResolvedValueOnce(true);
    apiFetch.mockResolvedValueOnce({ ok: true });
    await userEvent.click(screen.getByRole("button", { name: "Huỷ phiên bản v2" }));
    expect(apiFetch).toHaveBeenCalledWith("/api/bom/versions/2/cancel", { method: "POST" });
    expect(refresh).toHaveBeenCalled();
  });
});
