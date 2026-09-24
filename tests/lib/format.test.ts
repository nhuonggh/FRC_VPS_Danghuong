import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  formatCurrency, formatDate, formatDateTime, formatNumber, formatPercent, formatQty, NULL_TEXT,
} from "@/lib/format";

describe("format", () => {
  it("số: phân cách nghìn '.', thập phân ','", () => {
    expect(formatNumber(1234567)).toBe("1.234.567");
    expect(formatNumber(1234.5, 2)).toBe("1.234,5");
    expect(formatNumber(1234.5, 2, 2)).toBe("1.234,50");
    expect(formatNumber(-1234567)).toBe("-1.234.567");
    expect(formatNumber("20444.4444", 2)).toBe("20.444,44");
  });

  it("null/undefined/chuỗi rỗng → '—', còn 0 → '0' (null ≠ 0)", () => {
    expect(NULL_TEXT).toBe("—");
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(undefined)).toBe("—");
    expect(formatNumber("")).toBe("—");
    expect(formatNumber(0)).toBe("0");
    expect(formatCurrency(null)).toBe("—");
    expect(formatCurrency(0)).toBe("0 ₫");
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0)).toBe("0%");
  });

  it("tiền: '1.500.000 ₫'; âm giữ dấu trừ", () => {
    expect(formatCurrency(1500000)).toBe("1.500.000 ₫");
    expect(formatCurrency(-250000)).toBe("-250.000 ₫");
    expect(formatCurrency(1500000.4)).toBe("1.500.000 ₫");
  });

  it("số lượng: tối đa 3 số lẻ, bỏ số 0 thừa", () => {
    expect(formatQty("1250.000")).toBe("1.250");
    expect(formatQty("333.3333")).toBe("333,333");
    expect(formatQty(2.4)).toBe("2,4");
  });

  it("nhận Prisma.Decimal", () => {
    expect(formatCurrency(new Prisma.Decimal("1500000.00"))).toBe("1.500.000 ₫");
    expect(formatQty(new Prisma.Decimal("1250.000"))).toBe("1.250");
  });

  it("ngày theo giờ Việt Nam", () => {
    expect(formatDate("2026-09-30T16:50:00Z")).toBe("30/09/2026");
    expect(formatDate("2026-09-30T17:00:00Z")).toBe("01/10/2026");
    expect(formatDateTime("2026-09-30T16:50:00Z")).toBe("23:50 30/09/2026");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("không phải ngày")).toBe("—");
  });
});
