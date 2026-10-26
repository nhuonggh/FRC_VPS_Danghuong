import { describe, expect, it } from "vitest";
import { grossAmount, roundNearestThousand, roundUpThousand } from "@/lib/line-amount";

describe("thành tiền làm tròn lên nghìn đồng", () => {
  it("356.400 → 357.000; bội số 1.000 giữ nguyên; 0 giữ 0", () => {
    expect(roundUpThousand(356400)).toBe(357000);
    expect(roundUpThousand(357000)).toBe(357000);
    expect(roundUpThousand(500)).toBe(1000);
    expect(roundUpThousand(0)).toBe(0);
  });
  it("6,48 m² × 55.000 = 356.400 → 357.000", () => { expect(grossAmount(6.48, 55000)).toBe(357000); });
});

describe("làm tròn tổng đơn tới nghìn (quy tắc 500đ)", () => {
  it("lẻ ≥ 500đ lên, < 500đ xuống", () => {
    expect(roundNearestThousand(102_650)).toBe(103_000);
    expect(roundNearestThousand(102_480)).toBe(102_000);
    expect(roundNearestThousand(102_500)).toBe(103_000);
    expect(roundNearestThousand(102_499)).toBe(102_000);
    expect(roundNearestThousand(499)).toBe(0);
    expect(roundNearestThousand(0)).toBe(0);
  });
});
