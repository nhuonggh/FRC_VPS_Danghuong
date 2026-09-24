import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, SessionExpiredError } from "@/lib/api-fetch";
import { useToastStore } from "@/lib/toast";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  useToastStore.setState({ items: [] });
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("apiFetch", () => {
  it("gửi JSON + Idempotency-Key và trả body", async () => {
    fetchMock.mockResolvedValueOnce(res(200, { id: 5 }));
    const r = await apiFetch<{ id: number }>("/api/users", { method: "POST", json: { a: 1 }, idempotencyKey: "k1" });
    expect(r).toEqual({ id: 5 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect(new Headers(init.headers).get("idempotency-key")).toBe("k1");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("không có json/idempotencyKey → không tự thêm header content-type/idempotency-key", async () => {
    fetchMock.mockResolvedValueOnce(res(200, {}));
    await apiFetch("/api/users");
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init.headers).has("idempotency-key")).toBe(false);
    expect(new Headers(init.headers).has("content-type")).toBe(false);
  });

  it("lỗi 4xx/5xx → ApiError mang thông báo tiếng Việt của server", async () => {
    fetchMock.mockResolvedValueOnce(res(409, { error: "Tên đăng nhập đã tồn tại." }));
    await expect(apiFetch("/api/users")).rejects.toMatchObject({ status: 409, message: "Tên đăng nhập đã tồn tại." });
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    await expect(apiFetch("/api/users")).rejects.toBeInstanceOf(ApiError);
  });

  it("lỗi không có thông báo từ server → thông báo tiếng Việt mặc định", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 502 }));
    await expect(apiFetch("/api/users")).rejects.toMatchObject({ status: 502, message: "Có lỗi xảy ra, vui lòng thử lại." });
  });

  it("401 → SessionExpiredError + toast lỗi KHÔNG tự tắt, KHÔNG chuyển trang", async () => {
    const assign = vi.fn();
    const replace = vi.fn();
    vi.stubGlobal("location", { assign, replace, href: "/x" });
    fetchMock.mockResolvedValueOnce(res(401, { error: "hết hạn" }));
    await expect(apiFetch("/api/users")).rejects.toBeInstanceOf(SessionExpiredError);
    const items = useToastStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("error");
    expect(items[0]!.message).toMatch(/dữ liệu đang nhập vẫn được giữ/);
    expect(assign).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(location.href).toBe("/x");
  });

  it("401 chỉ ném lỗi — bấm Lưu lại sau khi đăng nhập lại vẫn gửi cùng Idempotency-Key", async () => {
    fetchMock.mockResolvedValueOnce(res(401, {}));
    await expect(apiFetch("/api/users", { method: "POST", json: { a: 1 }, idempotencyKey: "k" })).rejects.toBeInstanceOf(SessionExpiredError);
    fetchMock.mockResolvedValueOnce(res(200, { id: 9 }));
    await expect(apiFetch("/api/users", { method: "POST", json: { a: 1 }, idempotencyKey: "k" })).resolves.toEqual({ id: 9 });
    expect(new Headers(fetchMock.mock.calls[1]![1].headers).get("idempotency-key")).toBe("k");
  });

  it("mất mạng (fetch ném lỗi) → ApiError tiếng Việt", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(apiFetch("/api/users")).rejects.toMatchObject({ message: expect.stringMatching(/kết nối/) });
  });
});
