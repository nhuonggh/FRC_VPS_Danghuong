import { describe, expect, it } from "vitest";
import { parseViNumber } from "@/lib/parse-number";
const ok = (raw: unknown, value: string | null, opts = {}) => expect(parseViNumber(raw, opts)).toEqual({ ok: true, value });
const bad = (raw: unknown, opts = {}) => expect(parseViNumber(raw, opts).ok).toBe(false);
describe("parseViNumber", () => {
  it("đọc số Việt Nam, số Excel và ô trống mà không biến thành 0", () => { ok("1.234,5", "1234.5"); ok("3 000", "3000"); ok("1,234.5", "1234.5"); ok("0.450", "0.45"); ok(1250.5, "1250.5"); ok("", null); ok(null, null); ok("0", "0"); });
  it("từ chối chuỗi mơ hồ/sai, số âm và quá số lẻ", () => { bad("12abc"); bad("1,2,3"); bad("-5"); ok("-5", "-5", { allowNegative: true }); bad("1,1234567"); ok("1,1234567", "1.1234567", { maxFrac: 8 }); });
});
