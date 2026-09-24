// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportButton } from "@/components/ui/ExportButton";
import { SearchBox } from "@/components/ui/SearchBox";
import { buildExportHref, parseListParams } from "@/lib/query-params";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/x" }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); push.mockClear(); vi.useRealTimers(); });

const box = () => screen.getByRole("searchbox", { name: "Tìm kiếm" });
const type = (v: string) => fireEvent.change(box(), { target: { value: v } });
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe("SearchBox", () => {
  it("hiện giá trị q hiện tại", () => {
    render(<SearchBox basePath="/x" params={parseListParams({ q: "ton lanh" })} />);
    expect(box()).toHaveValue("ton lanh");
  });

  it("debounce 300ms: gõ liên tiếp chỉ đẩy URL 1 lần, đã trim, giữ filter, về trang 1", () => {
    render(<SearchBox basePath="/x" params={parseListParams({ status: "a", page: "4" }, ["status"])} />);
    type("t"); wait(200);
    type("tô"); wait(200);
    type("  tôn lạnh  "); wait(299);
    expect(push).not.toHaveBeenCalled();
    wait(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/x?q=t%C3%B4n+l%E1%BA%A1nh&status=a");
  });

  it("xoá hết → bỏ q khỏi URL", () => {
    render(<SearchBox basePath="/x" params={parseListParams({ q: "abc", page: "2" })} />);
    type(""); wait(300);
    expect(push).toHaveBeenCalledWith("/x");
  });

  it("không đẩy URL khi mới hiển thị hoặc khi giá trị không đổi (không làm mất trang đang xem)", () => {
    render(<SearchBox basePath="/x" params={parseListParams({ q: "abc", page: "4" })} />);
    wait(1000);
    expect(push).not.toHaveBeenCalled();
    type("abc "); wait(300); // chỉ thêm khoảng trắng cuối: trim → vẫn là "abc"
    expect(push).not.toHaveBeenCalled();
  });

  it("React StrictMode (effect chạy 2 lần trong dev) không tự đẩy URL về trang 1", () => {
    render(<StrictMode><SearchBox basePath="/x" params={parseListParams({ page: "4" })} /></StrictMode>);
    wait(1000);
    expect(push).not.toHaveBeenCalled();
  });

  it("URL đổi từ bên ngoài (vd nút 'Xóa bộ lọc') → ô tìm kiếm đồng bộ theo", () => {
    const { rerender } = render(<SearchBox basePath="/x" params={parseListParams({ q: "abc" })} />);
    rerender(<SearchBox basePath="/x" params={parseListParams({})} />);
    expect(box()).toHaveValue("");
    wait(1000);
    expect(push).not.toHaveBeenCalled();
  });

  it("URL cập nhật theo chính lần gõ trước không ghi đè chữ người dùng đang gõ tiếp", () => {
    const { rerender } = render(<SearchBox basePath="/x" params={parseListParams({})} />);
    type("ab"); wait(300);
    expect(push).toHaveBeenCalledTimes(1);
    type("abc"); // đang gõ tiếp thì URL của lần trước về tới
    rerender(<SearchBox basePath="/x" params={parseListParams({ q: "ab" })} />);
    expect(box()).toHaveValue("abc");
    wait(300);
    expect(push).toHaveBeenLastCalledWith("/x?q=abc");
  });

  it("giới hạn 200 ký tự", () => {
    render(<SearchBox basePath="/x" params={parseListParams({})} />);
    expect(box()).toHaveAttribute("maxlength", "200");
  });
});

describe("ExportButton", () => {
  it("là liên kết tải file trỏ tới route export với đúng bộ lọc đang xem (không kèm phân trang)", () => {
    const params = parseListParams({ q: "ton", status: "a", page: "3", pageSize: "50" }, ["status"]);
    render(<ExportButton href={buildExportHref("/api/products/export", params)} />);
    const link = screen.getByRole("link", { name: /Xuất Excel/ });
    expect(link).toHaveAttribute("href", "/api/products/export?q=ton&status=a");
    expect(link).toHaveAttribute("download");
  });
});
