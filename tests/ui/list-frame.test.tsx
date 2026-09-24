// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListPageLayout } from "@/components/ui/ListPageLayout";
import { PaginationFooter } from "@/components/ui/PaginationFooter";
import { StatCard } from "@/components/ui/StatCard";

afterEach(cleanup);

const href = (p: { page?: number; pageSize?: number }) => `/list?page=${p.page ?? ""}&size=${p.pageSize ?? ""}`;

describe("PaginationFooter", () => {
  it("hiện 'x–y / Tổng', cỡ trang đang chọn, liên kết giữ query", () => {
    render(<PaginationFooter total={248} page={2} pageSize={20} buildHref={href} />);
    expect(screen.getByText("Hiển thị 21–40 / Tổng: 248")).toBeInTheDocument();
    const sizes = screen.getByRole("navigation", { name: "Số dòng mỗi trang" });
    expect(sizes).toHaveTextContent("10152050100");
    expect(screen.getByRole("link", { name: "50" })).toHaveAttribute("href", "/list?page=1&size=50");
    expect(screen.getByRole("link", { name: "20" })).toHaveAttribute("aria-current", "true");
    expect(screen.getAllByRole("link", { name: "Trang sau" })[0]).toHaveAttribute("href", "/list?page=3&size=");
  });

  it("trang cuối: 'x–total' và Sau/Cuối bị vô hiệu (không phải link)", () => {
    render(<PaginationFooter total={45} page={3} pageSize={20} buildHref={href} />);
    expect(screen.getByText("Hiển thị 41–45 / Tổng: 45")).toBeInTheDocument();
    for (const name of ["Trang sau", "Trang cuối"]) {
      for (const el of screen.getAllByLabelText(name)) {
        expect(el).toHaveAttribute("aria-disabled", "true");
        expect(el).not.toHaveAttribute("href");
      }
    }
    expect(screen.getAllByRole("link", { name: "Trang trước" })[0]).toHaveAttribute("href", "/list?page=2&size=");
  });

  it("trang đầu: Trước/Đầu bị vô hiệu", () => {
    render(<PaginationFooter total={100} page={1} pageSize={20} buildHref={href} />);
    for (const name of ["Trang đầu", "Trang trước"]) {
      for (const el of screen.getAllByLabelText(name)) expect(el).toHaveAttribute("aria-disabled", "true");
    }
    expect(screen.getAllByText("Trang 1/5").length).toBeGreaterThan(0);
  });

  it("total = 0: không bao giờ hiện '1–0'; mọi nút điều hướng vô hiệu", () => {
    const { container } = render(<PaginationFooter total={0} page={1} pageSize={20} buildHref={href} />);
    expect(screen.getByText("Hiển thị 0–0 / Tổng: 0")).toBeInTheDocument();
    expect(container.textContent).not.toContain("1–0");
    for (const name of ["Trang đầu", "Trang trước", "Trang sau", "Trang cuối"]) {
      for (const el of screen.getAllByLabelText(name)) expect(el).toHaveAttribute("aria-disabled", "true");
    }
  });

  it("page vượt quá số trang được kẹp về trang cuối", () => {
    render(<PaginationFooter total={45} page={9} pageSize={20} buildHref={href} />);
    expect(screen.getByText("Hiển thị 41–45 / Tổng: 45")).toBeInTheDocument();
  });

  it("dính đáy: shrink-0 + sticky bottom (không absolute)", () => {
    const { container } = render(<PaginationFooter total={3} page={1} pageSize={20} buildHref={href} />);
    const cls = (container.firstElementChild as HTMLElement).className;
    expect(cls).toMatch(/\bshrink-0\b/);
    expect(cls).toMatch(/\bsticky\b/);
    expect(cls).not.toMatch(/\babsolute\b/);
  });
});

describe("ListPageLayout — flex-fill, footer không nhảy", () => {
  it("khung flex-col cao đầy; vùng bảng flex-1 min-h-0 overflow-auto; footer nằm ngoài vùng cuộn", () => {
    render(
      <ListPageLayout title="Khách hàng" actions={<button>Thêm mới</button>} footer={<div data-testid="footer" />}>
        <div data-testid="table" />
      </ListPageLayout>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Khách hàng" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thêm mới" })).toBeInTheDocument();
    const scroll = screen.getByTestId("table").parentElement!;
    expect(scroll.className).toMatch(/flex-1/);
    expect(scroll.className).toMatch(/min-h-0/);
    expect(scroll.className).toMatch(/overflow-auto/);
    const frame = scroll.parentElement!;
    expect(frame.className).toMatch(/flex-col/);
    expect(frame.className).toMatch(/flex-1/);
    expect(frame.className).toMatch(/overflow-hidden/);
    expect(frame).toContainElement(screen.getByTestId("footer"));
    expect(scroll).not.toContainElement(screen.getByTestId("footer"));
    expect(frame.parentElement!.className).toMatch(/\bh-full\b/);
    expect(frame.parentElement!.outerHTML).not.toMatch(/absolute/);
  });
});

describe("EmptyState — 3 loại", () => {
  it("empty: CTA Thêm mới vẫn hiển thị", () => {
    render(<EmptyState kind="empty" title="Chưa có khách hàng" description="Tạo khách hàng đầu tiên." action={<a href="/customers/new">Thêm mới</a>} />);
    expect(screen.getByRole("heading", { name: "Chưa có khách hàng" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Thêm mới" })).toHaveAttribute("href", "/customers/new");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("no-result: có nút Xóa bộ lọc", () => {
    render(<EmptyState kind="no-result" title="Không tìm thấy kết quả" action={<a href="/customers">Xóa bộ lọc</a>} />);
    expect(screen.getByRole("link", { name: "Xóa bộ lọc" })).toHaveAttribute("href", "/customers");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("error: role=alert và nút Thử lại", () => {
    render(<EmptyState kind="error" title="Không tải được dữ liệu" action={<button>Thử lại</button>} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Không tải được dữ liệu");
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeInTheDocument();
  });
});

describe("StatCard", () => {
  it("số phân cách nghìn + tabular; null → '—' (không phải 0)", () => {
    render(<><StatCard label="Tổng" value={12345} /><StatCard label="Chưa có" value={null} /></>);
    expect(screen.getByText("12.345").className).toMatch(/tabular/);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0")).toBeNull();
  });
  it("có href → là Link để bấm lọc; active đánh dấu aria-current", () => {
    render(<StatCard label="Đang hoạt động" value={5} href="/customers?status=active" active />);
    const link = screen.getByRole("link", { name: /Đang hoạt động/ });
    expect(link).toHaveAttribute("href", "/customers?status=active");
    expect(link).toHaveAttribute("aria-current", "true");
  });
  it("không href → không phải link", () => {
    render(<StatCard label="Tổng" value={1} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
