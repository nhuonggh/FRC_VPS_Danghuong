// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOTTOM_NAV_HEIGHT, BOTTOM_NAV_OFFSET } from "@/components/shell/layout-constants";
import { NewPage } from "@/components/ui/NewPage";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }) }));
const confirmMock = vi.fn();
vi.mock("@/lib/confirm-store", () => ({ confirm: (...a: unknown[]) => confirmMock(...a) }));

beforeEach(() => { push.mockClear(); confirmMock.mockReset(); });
afterEach(cleanup);

function setup(over: Partial<React.ComponentProps<typeof NewPage>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const isDirty = vi.fn(() => false);
  render(
    <NewPage backHref="/system/users" backLabel="Quay lại người dùng" title="Tạo mới người dùng" submitLabel="Tạo người dùng" isDirty={isDirty} onSubmit={onSubmit} {...over}>
      <input aria-label="Tên" />
    </NewPage>,
  );
  return { onSubmit, isDirty };
}

describe("NewPage (/new)", () => {
  it("bố cục: back-link <a href>, aside hiện tiêu đề, form ở main, cột main min-w-0", () => {
    setup();
    expect(screen.getByRole("link", { name: /Quay lại người dùng/ })).toHaveAttribute("href", "/system/users");
    expect(screen.getByRole("heading", { level: 1, name: "Tạo mới người dùng" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Tên" }).closest(".min-w-0")).not.toBeNull();
  });

  it("footer sticky đáy (không fixed/absolute): Hủy trái, Tạo phải, chạm ≥44px trên mobile", () => {
    setup();
    const cancel = screen.getByRole("button", { name: "Hủy" });
    const footer = cancel.parentElement!;
    expect(footer.className).toContain("sticky");
    expect(footer.className).toContain("bottom-0");
    // mobile: BottomNav (fixed, h-14, z cao hơn) đè đáy vùng cuộn → footer phải dính CÁCH đáy đúng chiều cao BottomNav
    expect(footer.className).toContain("max-md:bottom-14");
    expect(footer.className).toContain(BOTTOM_NAV_OFFSET);
    expect(BOTTOM_NAV_HEIGHT).toBe("h-14");
    expect(BOTTOM_NAV_OFFSET).toBe("max-md:bottom-14");
    expect(footer.className).not.toMatch(/\b(fixed|absolute)\b/);
    expect(Array.from(footer.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Hủy", "Tạo người dùng"]);
    footer.querySelectorAll("button").forEach((b) => expect(b.className).toContain("h-11"));
  });

  it("Tạo → gọi onSubmit; nút mặc định 'Tạo'", async () => {
    const { onSubmit } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Tạo người dùng" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("đang gửi: nút disabled ('Đang lưu'), bấm đúp chỉ gửi 1 lần, xong thì mở lại", async () => {
    let release!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((res) => { release = res; }));
    setup({ onSubmit });
    const btn = screen.getByRole("button", { name: "Tạo người dùng" });
    fireEvent.click(btn);
    fireEvent.click(btn); // trước khi React kịp vô hiệu nút
    const pending = await screen.findByRole("button", { name: "Đang lưu" });
    expect(pending).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hủy" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Tạo người dùng" })).toBeEnabled());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("lỗi → banner đóng được, GIỮ dữ liệu đã nhập, cho phép gửi lại", async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error("Tên đăng nhập đã tồn tại")).mockResolvedValueOnce(undefined);
    setup({ onSubmit });
    await userEvent.type(screen.getByRole("textbox", { name: "Tên" }), "abc");
    await userEvent.click(screen.getByRole("button", { name: "Tạo người dùng" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Tên đăng nhập đã tồn tại");
    expect(screen.getByRole("textbox", { name: "Tên" })).toHaveValue("abc");
    await userEvent.click(screen.getByRole("button", { name: "Đóng thông báo lỗi" }));
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Tạo người dùng" }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("lỗi không phải Error → thông báo tiếng Việt mặc định", async () => {
    setup({ onSubmit: vi.fn().mockRejectedValueOnce("boom") });
    await userEvent.click(screen.getByRole("button", { name: "Tạo người dùng" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tạo được, vui lòng thử lại.");
  });

  it("Hủy khi form sạch → về backHref, không hỏi", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(confirmMock).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/system/users");
  });

  it("Hủy khi dirty → hỏi; từ chối thì ở lại, đồng ý thì về", async () => {
    setup({ isDirty: () => true });
    confirmMock.mockResolvedValueOnce(false);
    await userEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(confirmMock).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    confirmMock.mockResolvedValueOnce(true);
    await userEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(push).toHaveBeenCalledWith("/system/users");
  });

  it("back-link khi dirty cũng phải hỏi (không mất dữ liệu âm thầm)", async () => {
    setup({ isDirty: () => true });
    confirmMock.mockResolvedValueOnce(false);
    await userEvent.click(screen.getByRole("link", { name: /Quay lại người dùng/ }));
    expect(confirmMock).toHaveBeenCalledOnce();
    expect(push).not.toHaveBeenCalled();
    confirmMock.mockResolvedValueOnce(true);
    await userEvent.click(screen.getByRole("link", { name: /Quay lại người dùng/ }));
    expect(push).toHaveBeenCalledWith("/system/users");
  });

  it("beforeunload chỉ chặn khi form dirty (đọc trạng thái MỚI NHẤT), gỡ khi unmount", () => {
    let dirty = false;
    const { unmount } = render(
      <NewPage backHref="/x" backLabel="Về" title="Tạo" isDirty={() => dirty} onSubmit={async () => {}}><p>f</p></NewPage>,
    );
    const fire = () => { const ev = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented; };
    expect(fire()).toBe(false);
    dirty = true;
    expect(fire()).toBe(true);
    unmount();
    expect(fire()).toBe(false);
  });
});
