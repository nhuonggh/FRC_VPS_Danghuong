import { describe, expect, it } from "vitest";
import { buildDimNote, parseDimNote } from "@/lib/length-expr";

describe("ghi chú dòng kích thước", () => {
  it("đọc lại đúng dài, tỷ lệ, số tấm và phần ghi chú tự do", () => {
    expect(parseDimNote("7,1 m × 1,08 × 7 = 53,676 m²")).toEqual({ user: "", length: 7.1, ratio: 1.08, pieces: 7 });
    expect(parseDimNote("giao sáng — 6,8 m × 1,08 × 1 = 7,344 m²")).toEqual({ user: "giao sáng", length: 6.8, ratio: 1.08, pieces: 1 });
  });
  it("ghi chú thường hoặc đã bị sửa hỏng mẫu ⇒ không phải dòng kích thước", () => {
    expect(parseDimNote("")).toBeNull(); expect(parseDimNote(null)).toBeNull(); expect(parseDimNote("giao sáng")).toBeNull();
    expect(parseDimNote("7,1 m × 1,08 × 7 = 53,676 m² thêm")).toBeNull();
  });
  it("ghép rồi đọc lại cho cùng kết quả", () => {
    const n = buildDimNote("khách lấy", { length: 4.5, pieces: 3 }, 1.1);
    expect(n).toBe("khách lấy — 4,5 m × 1,1 × 3 = 14,85 m²");
    expect(parseDimNote(n)).toEqual({ user: "khách lấy", length: 4.5, ratio: 1.1, pieces: 3 });
  });
});
