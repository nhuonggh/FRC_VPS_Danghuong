import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { prisma } from "@/lib/prisma";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("GET /api/health", () => {
  it("DB sống → 200 {status:'ok', db:true}, không cache, không lộ thông tin nhạy cảm", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", db: true });
    expect(Object.keys(body).sort()).toEqual(["db", "status", "time"]);
    expect(new Date(body.time).toISOString()).toBe(body.time);
  });

  it("DB lỗi → 503 {status:'error', db:false}, không rò chi tiết lỗi (host, mật khẩu, mã Prisma)", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(
      new Error("P1001: Can't reach database server at `db.internal:5432` password=hunter2"),
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const raw = await res.text();
    expect(JSON.parse(raw)).toMatchObject({ status: "error", db: false });
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(["db", "status", "time"]);
    expect(raw).not.toMatch(/P1001|db\.internal|hunter2|password/i);
    expect(log).toHaveBeenCalledTimes(1); // chi tiết chỉ đi vào log máy chủ
  });

  it("DB treo (không trả lời) → vẫn 503 trong vài giây, không treo endpoint", async () => {
    vi.useFakeTimers();
    vi.spyOn(prisma, "$queryRaw").mockReturnValueOnce(new Promise(() => {}) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = GET();
    await vi.advanceTimersByTimeAsync(5_000);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "error", db: false });
  });
});
