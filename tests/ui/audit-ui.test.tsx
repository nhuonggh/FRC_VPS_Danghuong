// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditDetail } from "@/app/(app)/system/audit-log/[id]/AuditDetail";
import { AuditTable } from "@/app/(app)/system/audit-log/AuditTable";
import { parseListParams } from "@/lib/query-params";

const push = vi.fn();
const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh: vi.fn() }),
  usePathname: () => "/system/audit-log/5",
  useSearchParams: () => new URLSearchParams(search),
}));

beforeEach(() => { localStorage.clear(); push.mockReset(); replace.mockReset(); search = ""; });
afterEach(cleanup);

const rows = [
  { id: 2, at: "2026-09-30T16:50:00.000Z", by: "Nguyễn Văn Nam", action: "order.update", entity: "SaleOrder", entityId: "12" },
  { id: 1, at: "2026-09-30T17:00:00.000Z", by: "Hệ thống", action: "user.lock", entity: "User", entityId: null },
];

describe("AuditTable", () => {
  const setup = (sp: Record<string, string> = {}) => render(<AuditTable rows={rows} params={parseListParams(sp, ["user", "entity"])} />);

  it("hiện giờ theo ICT (23:50 30/09 và 00:00 01/10), người thao tác, hành động, đối tượng; mã rỗng → '—'", () => {
    setup();
    expect(screen.getAllByText("23:50 30/09/2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("00:00 01/10/2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Nguyễn Văn Nam").length).toBeGreaterThan(0);
    expect(screen.getAllByText("order.update").length).toBeGreaterThan(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("dòng dẫn tới trang chi tiết; thao tác duy nhất là 'Xem' — KHÔNG có Sửa/Xóa/Khóa (nhật ký bất biến)", () => {
    setup();
    for (const l of screen.getAllByRole("link", { name: "Xem" })) expect(l.getAttribute("href")).toMatch(/^\/system\/audit-log\/[12]$/);
    expect(screen.queryByRole("link", { name: /Sửa/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Sửa|Xóa|Khóa/ })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull(); // không chọn nhiều/xóa hàng loạt
  });

  it("tiêu đề Thời gian sắp xếp được và giữ bộ lọc; đổi sắp xếp về trang 1", () => {
    setup({ entity: "User", page: "4" });
    const link = screen.getByRole("link", { name: /Thời gian/ });
    expect(link.getAttribute("href")).toBe("/system/audit-log?entity=User&sort=at");
  });
});

describe("AuditTable — chỉ báo sắp xếp mặc định", () => {
  const th = () => screen.getAllByRole("columnheader").find((h) => /Thời gian/.test(h.textContent ?? ""))!;
  const href = () => screen.getByRole("link", { name: /Thời gian/ }).getAttribute("href");
  const setup = (sp: Record<string, string> = {}) => render(<AuditTable rows={rows} params={parseListParams(sp, ["user", "entity"])} />);

  it("chưa chọn sort: cột Thời gian báo giảm dần (mặc định thật), bấm lần đầu → tăng dần (không phải vòng vô hiệu)", () => {
    setup();
    expect(th()).toHaveAttribute("aria-sort", "descending");
    expect(href()).toBe("/system/audit-log?sort=at");
  });

  it("sort=-at tường minh cũng bấm được sang tăng dần; sort=at → quay về -at", () => {
    setup({ sort: "-at" });
    expect(th()).toHaveAttribute("aria-sort", "descending");
    expect(href()).toBe("/system/audit-log?sort=at");
    cleanup();
    setup({ sort: "at" });
    expect(th()).toHaveAttribute("aria-sort", "ascending");
    expect(href()).toBe("/system/audit-log?sort=-at");
  });

  it("sort cột khác: Thời gian không còn cờ; bấm cột đang sort giảm dần → về mặc định (bỏ sort)", () => {
    setup({ sort: "-action" });
    expect(th()).toHaveAttribute("aria-sort", "none");
    expect(screen.getByRole("link", { name: /Hành động/ }).getAttribute("href")).toBe("/system/audit-log");
  });
});

const entry = {
  id: 5, at: "2026-09-30T16:50:00.000Z", by: "Nguyễn Văn Nam", action: "product.update", entity: "Product", entityId: "9", ip: "10.0.0.1",
  changes: [
    { path: "name", before: "Tôn A", after: "Tôn B" },
    { path: "qty", before: "10,5", after: "12" },
    { path: "code", before: "—", after: "SP-1" },
  ],
  hiddenByPermission: false, truncated: false,
};

describe("AuditDetail", () => {
  it("tab Thông tin: hành động, đối tượng, mã, người, giờ ICT, IP; chỉ xem — không nút sửa", () => {
    render(<AuditDetail entry={entry} />);
    expect(screen.getAllByText("product.update").length).toBeGreaterThan(0);
    expect(screen.getAllByText("23:50 30/09/2026").length).toBeGreaterThan(0);
    expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /chỉnh sửa|Sửa|Lưu|Hủy/i })).toBeNull();
    expect(screen.getByRole("link", { name: /Quay lại nhật ký/ })).toHaveAttribute("href", "/system/audit-log");
  });

  it("tab 'Số cũ / số mới' có số đếm; bảng Trường / Số cũ / Số mới", async () => {
    search = "tab=changes";
    render(<AuditDetail entry={entry} />);
    expect(screen.getAllByRole("button", { name: /Số cũ \/ số mới \(3\)/ }).length).toBeGreaterThan(0);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Trường", "Số cũ", "Số mới"]);
    const r = within(table).getByText("qty").closest("tr")!;
    expect(within(r).getByText("10,5")).toBeInTheDocument();
    expect(within(r).getByText("12")).toBeInTheDocument();
    expect(within(table).getByText("—")).toBeInTheDocument(); // trường vừa thêm: số cũ "—"
  });

  it("không có thay đổi: thông báo rõ", () => {
    search = "tab=changes";
    render(<AuditDetail entry={{ ...entry, changes: [] }} />);
    expect(screen.getByText("Thao tác này không ghi số liệu trước/sau.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("field bị ẩn theo quyền: báo cho người xem (không nhầm với 'không ghi số liệu')", () => {
    search = "tab=changes";
    render(<AuditDetail entry={{ ...entry, changes: [], hiddenByPermission: true }} />);
    expect(screen.getByText(/Một số trường bị ẩn theo quyền của bạn/)).toBeInTheDocument();
    expect(screen.queryByText("Thao tác này không ghi số liệu trước/sau.")).toBeNull();
  });

  it("payload quá lớn: báo đã rút gọn danh sách", () => {
    search = "tab=changes";
    render(<AuditDetail entry={{ ...entry, truncated: true }} />);
    expect(screen.getByText(/Chỉ hiển thị .* thay đổi đầu tiên/)).toBeInTheDocument();
  });

  it("giá trị dài: cắt ngắn trong ô + mở rộng khi bấm; ô không tràn khung (break-words)", async () => {
    search = "tab=changes";
    const long = "z".repeat(1500);
    render(<AuditDetail entry={{ ...entry, changes: [{ path: "blob", before: "—", after: long }] }} />);
    const summary = screen.getByText(/Xem đầy đủ/);
    expect(summary).toBeInTheDocument();
    const cell = summary.closest("td")!;
    expect(cell.className).toMatch(/break-words|break-all/);
    // phần xem trước ngắn hơn giá trị đầy đủ
    expect(cell.querySelector("[data-preview]")!.textContent!.length).toBeLessThan(long.length);
    await userEvent.click(summary);
    expect(cell.textContent).toContain(long);
  });
});
