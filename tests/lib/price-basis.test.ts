import { describe, expect, it } from "vitest";
import { resolvePriceBasis, sameUnit, unitKind } from "@/lib/price-basis";

describe("resolvePriceBasis — ĐVT (cột E) + Tính giá theo (cột F)", () => {
  it("ĐVT kg/bình/cây thắng cột F ⇒ Theo ĐVT", () => {
    expect(resolvePriceBasis("kg", "Mét dài")).toMatchObject({ basis: "UNIT", unit: "kg" });
    expect(resolvePriceBasis("bình", "")).toMatchObject({ basis: "UNIT", unit: "bình" });
    expect(resolvePriceBasis("cây", "Mét vuông")).toMatchObject({ basis: "UNIT", unit: "cây" });
  });
  it("F ghi thẳng tên đơn vị: nhận, ĐVT trống thì lấy làm ĐVT", () => {
    expect(resolvePriceBasis("", "bình")).toMatchObject({ basis: "UNIT", unit: "bình" });
    expect(resolvePriceBasis("bình", "bình")).toMatchObject({ basis: "UNIT", unit: "bình" });
  });
  it("m/m2 + F: F quyết định, F trống suy từ E", () => {
    expect(resolvePriceBasis("m", "Mét vuông").basis).toBe("AREA");
    expect(resolvePriceBasis("m2", "").basis).toBe("AREA");
    expect(resolvePriceBasis("m²", "").basis).toBe("AREA");
    expect(resolvePriceBasis("md", "").basis).toBe("LENGTH");
    expect(resolvePriceBasis("", "").basis).toBeUndefined();
  });
  it("lỗi: Theo ĐVT mà không có ĐVT; F lạ khi ĐVT là mét", () => {
    expect(resolvePriceBasis("", "Theo ĐVT").error).toMatch(/chưa nhập ĐVT/);
    expect(resolvePriceBasis("m2", "lung tung").error).toMatch(/không hợp lệ/);
  });
  it("unitKind / sameUnit", () => {
    expect(unitKind("M2")).toBe("AREA"); expect(unitKind("kg")).toBe("OTHER"); expect(unitKind(" ")).toBeNull();
    expect(sameUnit("Bình", "binh")).toBe(true); expect(sameUnit("", "")).toBe(false);
  });
});
