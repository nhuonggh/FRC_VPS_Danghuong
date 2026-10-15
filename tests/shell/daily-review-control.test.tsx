// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DailyReviewControl } from "@/components/home/DailyReviewControl";
import { apiFetch } from "@/lib/api-fetch";
import type { ReviewState } from "@/server/home/daily-review";
const { router } = vi.hoisted(() => ({ router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/lib/api-fetch", async (original) => ({ ...await original<typeof import("@/lib/api-fetch")>(), apiFetch: vi.fn() }));
const unseen: ReviewState = { status: "unseen", seenAt: null, checkedAt: null };
const seen: ReviewState = { status: "seen", seenAt: "2026-10-15T03:00:00Z", checkedAt: null };
const checked: ReviewState = { ...seen, status: "checked", checkedAt: "2026-10-15T03:05:00Z" };
const props = { day: "2026-10-15", itemKey: "receipts", version: "a".repeat(32) };
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("daily review controls", () => {
  it("opening detail saves seen but never automatically confirms; tick and untick persist explicitly", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(seen).mockResolvedValueOnce(checked).mockResolvedValueOnce(seen);
    render(<DailyReviewControl {...props} initial={unseen} />);
    expect(await screen.findByText("Đã xem")).toBeInTheDocument();
    const box = screen.getByRole("checkbox");
    await waitFor(() => expect(box).toBeEnabled());
    expect(box).not.toBeChecked();
    expect(apiFetch).toHaveBeenNthCalledWith(1, "/api/home/daily/review", expect.objectContaining({ json: { day: props.day, itemKey: props.itemKey, expectedVersion: props.version, action: "seen" } }));
    await userEvent.click(box);
    expect(await screen.findByText("Đã kiểm tra")).toBeInTheDocument();
    expect(box).toBeChecked();
    await userEvent.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    expect(apiFetch).toHaveBeenCalledTimes(3);
  });
  it("saved confirmation survives remount without rewriting the seen timestamp", () => {
    render(<DailyReviewControl {...props} initial={checked} />);
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(apiFetch).not.toHaveBeenCalled();
  });
  it("failed seen save remains unchecked and exposes retry", async () => {
    vi.mocked(apiFetch).mockRejectedValueOnce(new Error("Mất kết nối")).mockResolvedValueOnce(seen);
    render(<DailyReviewControl {...props} initial={unseen} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Mất kết nối");
    expect(screen.getByRole("checkbox")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Đã xem")).toBeInTheDocument();
  });
});
