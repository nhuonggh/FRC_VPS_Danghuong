// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignOutButton } from "@/app/change-password/SignOutButton";

const signOut = vi.fn();
vi.mock("next-auth/react", () => ({ signOut: (...a: unknown[]) => signOut(...a) }));

beforeEach(() => signOut.mockReset());
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
});
