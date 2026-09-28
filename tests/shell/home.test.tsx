// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "@/app/(app)/page";
import type { SessionActor } from "@/server/auth/actor";

const requireActor = vi.fn();
vi.mock("@/server/auth/session", () => ({ requireActor: (...a: unknown[]) => requireActor(...a) }));

const actor = (perms: string[], fullName = "Trần Văn An"): SessionActor =>
  ({ userId: 1, username: "an", fullName, perms: new Set(perms), mustChangePassword: false, authMethod: "password" });

async function renderHome() {
  render(await HomePage());
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T03:00:00Z")); // 10:00 ICT
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  requireActor.mockReset();
});

describe("Trang chủ — Level 0 (module selector)", () => {
  it("chào theo giờ ICT + tên người dùng; chỉ thẻ module mà actor được vào, link /m/<key>", async () => {
    requireActor.mockResolvedValue(actor(["user.view", "audit.view"]));
    await renderHome();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Chào buổi sáng, Trần Văn An");
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/m/system");
    expect(within(links[0]!).getByText("Hệ thống")).toBeInTheDocument();
    expect(within(links[0]!).getByText("2 chức năng")).toBeInTheDocument(); // user.view + audit.view; role.manage bị ẩn
    expect(screen.queryByText("Kế toán")).toBeNull();
  });

  it("module chỉ có chức năng 'planned' bị ẩn; module Kho hiện khi stock.view đã có màn tồn kho", async () => {
    requireActor.mockResolvedValue(actor(["order.view", "stock.view", "user.view"]));
    await renderHome();
    expect(screen.queryByText("Bán hàng")).toBeNull();
    expect(screen.getByText("Kho")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("không quyền nào → thông báo trống, không có thẻ", async () => {
    requireActor.mockResolvedValue(actor([]));
    await renderHome();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByText(/chưa được cấp quyền vào chức năng nào/)).toBeInTheDocument();
  });

  it("giờ chiều theo ICT dù máy chủ ở múi giờ khác (17:59 ICT = 10:59Z)", async () => {
    vi.setSystemTime(new Date("2026-09-24T10:59:00Z"));
    requireActor.mockResolvedValue(actor(["user.view"]));
    await renderHome();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Chào buổi chiều");
  });

  it("tự kiểm đăng nhập (layout không đủ)", async () => {
    requireActor.mockResolvedValue(actor(["user.view"]));
    await renderHome();
    expect(requireActor).toHaveBeenCalledTimes(1);
  });
});
