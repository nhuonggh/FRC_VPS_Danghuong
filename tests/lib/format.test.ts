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

  it("chuỗi chỉ có khoảng trắng / NaN / vô cực → '—', không bao giờ '0'", () => {
    for (const v of [" ", "  ", "\t", "\n ", NaN, Infinity, -Infinity, "abc", "1,5"]) {
      expect(formatNumber(v)).toBe("—");
    }
    expect(formatCurrency(" ")).toBe("—");
    expect(formatCurrency("\t")).toBe("—");
    expect(formatPercent("  ")).toBe("—");
    expect(formatQty(" ")).toBe("—");
    expect(formatNumber(" 12 ")).toBe("12");
  });

  it("làm tròn half-up trên chuỗi thập phân (khớp NUMERIC của Postgres), không qua float", () => {
    expect(formatNumber("1.005", 2)).toBe("1,01");
    expect(formatNumber(new Prisma.Decimal("1.005"), 2)).toBe("1,01");
    expect(formatNumber("8.345", 2)).toBe("8,35");
    expect(formatNumber(8.345, 2)).toBe("8,35");
    expect(formatNumber(1.45, 1)).toBe("1,5");
    expect(formatNumber("1.45", 1)).toBe("1,5");
    expect(formatNumber(0.5, 0)).toBe("1");
    expect(formatNumber(-0.5, 0)).toBe("-1"); // half-up = ra xa số 0
    expect(formatNumber(-0.4, 0)).toBe("0"); // không có "-0"
    expect(formatNumber("-0.001", 2)).toBe("0");
    expect(formatNumber("-0.00", 2, 2)).toBe("0,00");
    expect(formatNumber("999.999", 2)).toBe("1.000");
    expect(formatNumber("0.999", 2)).toBe("1");
    expect(formatNumber(-1.005, 2)).toBe("-1,01");
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(0, 2, 2)).toBe("0,00");
    expect(formatNumber(-1234567.891, 2)).toBe("-1.234.567,89");
  });

  it("số rất lớn giữ đủ chữ số, không dạng mũ", () => {
    expect(formatNumber("12345678901234567890.55", 1)).toBe("12.345.678.901.234.567.890,6");
    expect(formatNumber("12345678901234567890.55", 2)).toBe("12.345.678.901.234.567.890,55");
    expect(formatNumber("-9007199254740993")).toBe("-9.007.199.254.740.993");
    expect(formatNumber(1e21)).toBe("1.000.000.000.000.000.000.000");
    expect(formatNumber(1.5e-7, 8)).toBe("0,00000015");
    expect(formatCurrency(new Prisma.Decimal("12345678901234567890.55"))).toBe("12.345.678.901.234.567.891 ₫");
  });

  it("minFrac > maxFrac được nâng maxFrac (không cắt cụt bất ngờ)", () => {
    expect(formatNumber(5, 0, 2)).toBe("5,00");
    expect(formatNumber(1.234, 1, 3)).toBe("1,234");
  });

  it("ngày theo giờ Việt Nam", () => {
    expect(formatDate("2026-09-30T16:50:00Z")).toBe("30/09/2026");
    expect(formatDate("2026-09-30T17:00:00Z")).toBe("01/10/2026");
    expect(formatDateTime("2026-09-30T16:50:00Z")).toBe("23:50 30/09/2026");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("không phải ngày")).toBe("—");
  });
});
