// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it } from "vitest";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";

describe("useIdempotencyKey", () => {
  it("1 khoá cho mỗi lần mở form: render lại / retry vẫn CÙNG khoá", () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());
    const first = result.current.key;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    rerender();
    rerender();
    expect(result.current.key).toBe(first);
  });

  it("khoá đổi CHỈ sau reset() (sau khi tạo thành công) và bền vững qua các lần render sau", () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());
    const first = result.current.key;
    act(() => result.current.reset());
    const second = result.current.key;
    expect(second).not.toBe(first);
    rerender();
    expect(result.current.key).toBe(second);
  });

  it("reset ổn định qua các lần render (dùng an toàn trong dependency list)", () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey());
    const reset = result.current.reset;
    rerender();
    expect(result.current.reset).toBe(reset);
  });

  it("2 form mở riêng biệt có 2 khoá khác nhau", () => {
    const a = renderHook(() => useIdempotencyKey());
    const b = renderHook(() => useIdempotencyKey());
    expect(a.result.current.key).not.toBe(b.result.current.key);
  });

  it("StrictMode (render đôi) không làm khoá đổi giữa các lần render", () => {
    const { result, rerender } = renderHook(() => useIdempotencyKey(), { wrapper: StrictMode });
    const k = result.current.key;
    rerender();
    expect(result.current.key).toBe(k);
  });
});
