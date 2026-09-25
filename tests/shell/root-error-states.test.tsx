// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RootError from "@/app/error";
import GlobalError from "@/app/global-error";
import RootNotFound from "@/app/not-found";
import CatchAllPage from "@/app/(app)/[...slug]/page";

const requireActor = vi.fn();
const notFoundMock = vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); });
vi.mock("@/server/auth/session", () => ({ requireActor: (...a: unknown[]) => requireActor(...a) }));
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

const hostile = () => {
  const error = Object.assign(new Error("PrismaClientInitializationError P1001 at db.internal:5432 password=hunter2"), { digest: "d1g3st" });
  error.stack = "Error: boom\n    at /srv/app/secret.ts:1:1";
  return error;
};
const LEAK = /Prisma|P1001|db\.internal|hunter2|boom|\/srv\/app|secret\.ts/;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  requireActor.mockReset();
  notFoundMock.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("app/error.tsx (lỗi ngoài khung, vd layout (app) hoặc trang đăng nhập)", () => {
  it("tiếng Việt, không lộ message/stack, có digest, Thử lại gọi reset, có đường về trang chủ", async () => {
    const reset = vi.fn();
    const { container } = render(<RootError error={hostile()} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Có lỗi xảy ra");
    expect(container.textContent).not.toMatch(LEAK);
    expect(screen.getByText("Mã lỗi: d1g3st")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Về trang chủ" })).toHaveAttribute("href", "/");
  });

  it("không có digest thì không hiện dòng mã lỗi; lỗi được ghi vào console cho người vận hành", () => {
    const err = new Error("x");
    render(<RootError error={err} reset={() => {}} />);
    expect(screen.queryByText(/Mã lỗi/)).toBeNull();
    expect(console.error).toHaveBeenCalledWith("[app-error]", err);
  });
});

describe("app/global-error.tsx (thay cả root layout)", () => {
  it("tự dựng <html lang=vi><body>, tiếng Việt, không lộ message/stack, có digest và link về trang chủ", () => {
    const html = renderToStaticMarkup(<GlobalError error={hostile()} reset={() => {}} />);
    expect(html).toMatch(/^<html lang="vi"/);
    expect(html).toContain("<body");
    expect(html).toContain("Có lỗi xảy ra");
    expect(html).toContain("Mã lỗi: d1g3st");
    expect(html).toContain('href="/"');
    expect(html).not.toMatch(LEAK);
  });

  it("nạp globals.css (không có root layout để nạp thay) và gọi reset khi bấm Thử lại", async () => {
    expect(readFileSync("src/app/global-error.tsx", "utf8")).toMatch(/import\s+["']\.\/globals\.css["']/);
    const reset = vi.fn();
    // ErrorPanel là phần thân dùng chung; dựng trực tiếp để bấm được (không lồng <html> trong jsdom)
    const { ErrorPanel } = await import("@/components/ui/ErrorPanel");
    render(<ErrorPanel digest="abc" reset={reset} />);
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("app/not-found.tsx (URL không khớp, ngoài khung)", () => {
  it("tiếng Việt, có đường về trang chủ", () => {
    render(<RootNotFound />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Không tìm thấy trang hoặc bản ghi");
    expect(screen.getByRole("link", { name: "Về trang chủ" })).toHaveAttribute("href", "/");
  });
});

describe("(app)/[...slug]/page.tsx — URL lạ của người đã đăng nhập hiện 404 TRONG khung", () => {
  it("tự gọi requireActor() rồi notFound()", async () => {
    requireActor.mockResolvedValue({});
    await expect(CatchAllPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(requireActor).toHaveBeenCalledTimes(1);
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });

  it("chưa đăng nhập: requireActor chuyển hướng/ném trước → không tới notFound", async () => {
    requireActor.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(CatchAllPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});
