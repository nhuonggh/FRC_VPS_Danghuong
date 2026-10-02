// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CloseChecklist } from "@/components/period/CloseChecklist";
import type { getCloseChecklist } from "@/server/period/close-checklist";

type Checklist = Awaited<ReturnType<typeof getCloseChecklist>>;
afterEach(cleanup);

const base: Checklist = {
  period: { id: 2, name: "Kỳ 09/2026", openedAt: new Date("2026-09-01T00:00:00Z") },
  blockers: [
    { key: "provisional-sales", severity: "BLOCK", title: "Đơn bán còn thiếu tồn", hint: "Nhập bù hàng.", count: 1, items: [{ id: 3, code: "DH000003", description: "U6-TON-001 · thiếu giá vốn", href: "/sales/orders/3" }] },
    { key: "open-trips", severity: "BLOCK", title: "Chuyến chưa xác nhận hoàn tất", hint: "h", count: 0, items: [] },
    { key: "draft-stocktakes", severity: "BLOCK", title: "Phiếu kiểm kho còn nháp", hint: "h", count: 0, items: [] },
  ],
  warnings: [{ key: "draft-orders", severity: "WARN", title: "Đơn nháp sẽ cần mang sang kỳ mới", hint: "h", count: 0, items: [] }],
  blockerCount: 1,
  warningCount: 0,
};

describe("CloseChecklist", () => {
  it("shows blocker, warning, current period, and links to affected documents", () => {
    render(<CloseChecklist checklist={base} />);
    expect(screen.getByRole("heading", { name: "Kết sổ cuối kỳ" })).toBeInTheDocument();
    expect(screen.getByText("Kỳ 09/2026")).toBeInTheDocument();
    expect(screen.getByText("1 mục chặn")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /DH000003/ })).toHaveAttribute("href", "/sales/orders/3");
    expect(screen.getByText("Nhập bù hàng.")).toBeInTheDocument(); // gợi ý xử lý chỉ hiện khi mục còn vướng
    expect(screen.getAllByText(/Đạt — không có mục cần xử lý/)).toHaveLength(3); // 2 chặn + 1 cảnh báo đạt
    expect(screen.getByText("Đơn nháp sẽ cần mang sang kỳ mới")).toBeInTheDocument();
  });

  it("reports no blockers when the checklist is clear", () => {
    const clear: Checklist = { ...base, blockerCount: 0, blockers: base.blockers.map((item) => ({ ...item, count: 0, items: [] })) };
    render(<CloseChecklist checklist={clear} />);
    expect(screen.getByText("Không có mục chặn")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Đơn bán còn thiếu tồn" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chuyến chưa xác nhận hoàn tất" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Phiếu kiểm kho còn nháp" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Đơn nháp sẽ cần mang sang kỳ mới" })).toBeInTheDocument();
  });
});