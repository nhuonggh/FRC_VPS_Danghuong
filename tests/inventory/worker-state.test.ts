import { describe, expect, it } from "vitest";
import { adoptWorkerState, RETRY_BASE_MS } from "@/server/inventory/recompute";

describe("singleton worker trên globalThis: trộn mặc định (HMR — object hình dạng cũ)", () => {
  it("không có object cũ → trạng thái mặc định đủ trường", () => {
    const s = adoptWorkerState(undefined);
    expect(s).toMatchObject({ current: null, again: false, retryTimer: null, sweepTimer: null, claimFailures: 0 });
    expect(s.bootTimers).toBeInstanceOf(Set);
  });

  it("object cũ thiếu claimFailures / bootTimers → được điền mặc định, GIỮ danh tính + giá trị đang có; backoff không NaN", () => {
    const running = Promise.resolve();
    const old = { current: running, again: true } as Parameters<typeof adoptWorkerState>[0];
    const s = adoptWorkerState(old);
    expect(s).toBe(old);
    expect(s.current).toBe(running);
    expect(s.again).toBe(true);
    expect(s.claimFailures).toBe(0);
    expect(s.bootTimers).toBeInstanceOf(Set);
    const backoff = Math.min(RETRY_BASE_MS * 2 ** Math.max(0, s.claimFailures - 1), 60_000);
    expect(Number.isNaN(backoff)).toBe(false);
  });

  it("claimFailures sai kiểu (NaN) → về 0; giá trị hợp lệ giữ nguyên", () => {
    expect(adoptWorkerState({ claimFailures: Number.NaN }).claimFailures).toBe(0);
    expect(adoptWorkerState({ claimFailures: 3 }).claimFailures).toBe(3);
  });
});
