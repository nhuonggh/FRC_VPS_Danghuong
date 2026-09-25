// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppError from "@/app/(app)/error";
import NotFound from "@/app/(app)/not-found";

afterEach(cleanup);

describe("(app)/not-found", () => {
  it("tiếng Việt, có đường về trang chủ, không phải trang trắng", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Không tìm thấy trang hoặc bản ghi");
    expect(screen.getByRole("link", { name: "Về trang chủ" })).toHaveAttribute("href", "/");
  });
});

describe("(app)/error", () => {
  it("thông điệp chung + Thử lại gọi reset; KHÔNG in message/stack của lỗi; hiện mã digest", async () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("PrismaClientKnownRequestError: secret table users"), { digest: "abc123" });
    error.stack = "Error: boom\n    at /srv/app/secret.ts:1:1";
    const { container } = render(<AppError error={error} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Có lỗi xảy ra");
    expect(container.textContent).not.toMatch(/Prisma|secret|boom|\/srv\/app/);
    expect(screen.getByText("Mã lỗi: abc123")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("có đường về trang chủ và không có digest thì không hiện dòng mã lỗi", () => {
    render(<AppError error={new Error("x")} reset={() => {}} />);
    expect(screen.getByRole("link", { name: "Về trang chủ" })).toHaveAttribute("href", "/");
    expect(screen.queryByText(/Mã lỗi/)).toBeNull();
  });

  it("ghi lỗi vào console để người vận hành thấy (không hiện cho người dùng)", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("boom");
    render(<AppError error={err} reset={() => {}} />);
    expect(log).toHaveBeenCalledWith("[app-error]", err);
    log.mockRestore();
  });
});
