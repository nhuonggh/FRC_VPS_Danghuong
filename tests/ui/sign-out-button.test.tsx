// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignOutButton } from "@/app/change-password/SignOutButton";
import { useToastStore } from "@/lib/toast";

const signOut = vi.fn();
vi.mock("next-auth/react", () => ({ signOut: (...a: unknown[]) => signOut(...a) }));

beforeEach(() => {
  signOut.mockReset();
  useToastStore.setState({ items: [] });
});
afterEach(cleanup);

describe("SignOutButton (/change-password nằm ngoài khung nên cần lối thoát riêng)", () => {
  it("bấm 'Đăng xuất' → signOut về /login", async () => {
    signOut.mockResolvedValue(undefined);
    render(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/login" });
  });

  it("bấm đúp chỉ gọi signOut một lần; chạm ≥44px trên mobile", async () => {
    let release!: () => void;
    signOut.mockReturnValue(new Promise<void>((r) => { release = r; }));
    render(<SignOutButton />);
    const btn = screen.getByRole("button", { name: "Đăng xuất" });
    expect(btn).toHaveClass("h-11", "md:h-10");
    fireEvent.click(btn);
    fireEvent.click(btn); // trước khi React kịp vô hiệu nút
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Đang đăng xuất" })).toBeDisabled();
    await act(async () => { release(); });
  });

  it("signOut bị từ chối (mạng/máy chủ lỗi) → toast lỗi tiếng Việt, nút bật lại để thử lại, không lỗi chưa bắt", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    signOut.mockRejectedValueOnce(new Error("Network down"));
    signOut.mockResolvedValueOnce(undefined);
    render(<SignOutButton />);
    await userEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
    const items = useToastStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "error", message: "Không đăng xuất được. Vui lòng thử lại." });
    expect(items[0]!.message).not.toMatch(/Network/);
    expect(await screen.findByRole("button", { name: "Đăng xuất" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Đăng xuất" })); // thử lại được
    expect(signOut).toHaveBeenCalledTimes(2);
    await new Promise((r) => setTimeout(r, 0));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
