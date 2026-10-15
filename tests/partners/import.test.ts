import { describe, expect, it } from "vitest";
import { parseYesNo } from "@/server/partners/import-spec";

describe("parseYesNo", () => {
  it("nhận Có/Không không dấu hoặc có dấu; không đoán giá trị lạ", () => {
    expect(parseYesNo("Có")).toBe(true);
    expect(parseYesNo("khong")).toBe(false);
    expect(parseYesNo("")).toBe(false);
    expect(parseYesNo("có lẽ")).toBeNull();
  });
});
