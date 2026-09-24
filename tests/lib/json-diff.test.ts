import { describe, expect, it } from "vitest";
import { diffJson } from "@/lib/json-diff";

describe("diffJson — số cũ / số mới", () => {
  it("field đổi, thêm, bỏ; sắp theo đường dẫn", () => {
    expect(diffJson({ a: 1, b: "x", c: true }, { a: 2, b: "x", d: 5 })).toEqual([
      { path: "a", before: 1, after: 2 },
      { path: "c", before: true, after: undefined },
      { path: "d", before: undefined, after: 5 },
    ]);
  });

  it("object lồng nhau: đường dẫn chấm; giá trị bằng nhau không xuất hiện", () => {
    expect(diffJson({ p: { q: 1, r: 2 } }, { p: { q: 1, r: 3 } })).toEqual([{ path: "p.r", before: 2, after: 3 }]);
  });

  it("mảng so như MỘT giá trị", () => {
    expect(diffJson({ roles: ["A", "B"] }, { roles: ["A", "C"] })).toEqual([{ path: "roles", before: ["A", "B"], after: ["A", "C"] }]);
    expect(diffJson({ roles: ["A"] }, { roles: ["A"] })).toEqual([]);
  });

  it("before null (tạo mới) → mọi field là 'thêm'; after null (xóa) → mọi field là 'bỏ'", () => {
    expect(diffJson(null, { a: 1 })).toEqual([{ path: "a", before: undefined, after: 1 }]);
    expect(diffJson({ a: 1 }, null)).toEqual([{ path: "a", before: 1, after: undefined }]);
    expect(diffJson(null, null)).toEqual([]);
  });

  it("phân biệt 0 / '' / null / undefined", () => {
    expect(diffJson({ a: 0 }, { a: null })).toEqual([{ path: "a", before: 0, after: null }]);
    expect(diffJson({ a: "" }, { a: 0 })).toEqual([{ path: "a", before: "", after: 0 }]);
    expect(diffJson({ a: null }, {})).toEqual([{ path: "a", before: null, after: undefined }]);
    expect(diffJson({}, { a: null })).toEqual([{ path: "a", before: undefined, after: null }]);
  });

  it("chuỗi Decimal so theo chuỗi (không ép số): '10.5000' ≠ '10.5'; giống hệt thì bằng nhau", () => {
    expect(diffJson({ qty: "10.5000" }, { qty: "10.5000" })).toEqual([]);
    expect(diffJson({ qty: "10.5000" }, { qty: "10.5" })).toEqual([{ path: "qty", before: "10.5000", after: "10.5" }]);
    expect(diffJson({ qty: "1" }, { qty: 1 })).toEqual([{ path: "qty", before: "1", after: 1 }]);
  });

  it("mảng chứa object: khoá khác thứ tự vẫn bằng nhau (jsonb không giữ thứ tự khoá); phần tử khác → đổi", () => {
    expect(diffJson({ lines: [{ a: 1, b: 2 }] }, { lines: [{ b: 2, a: 1 }] })).toEqual([]);
    expect(diffJson({ lines: [{ a: 1 }] }, { lines: [{ a: 2 }] })).toEqual([{ path: "lines", before: [{ a: 1 }], after: [{ a: 2 }] }]);
    expect(diffJson({ l: [1, 2] }, { l: [2, 1] })).toHaveLength(1); // thứ tự mảng có nghĩa
  });

  it("object rỗng là một giá trị, khác với vắng mặt", () => {
    expect(diffJson({ meta: {} }, { meta: {} })).toEqual([]);
    expect(diffJson({}, { meta: {} })).toEqual([{ path: "meta", before: undefined, after: {} }]);
  });

  it("thứ tự kết quả ổn định: không phụ thuộc thứ tự khoá đầu vào", () => {
    const a = diffJson({ z: 1, a: 1, m: { y: 1, b: 1 } }, { m: { b: 2, y: 2 }, a: 2, z: 2 });
    const b = diffJson({ m: { b: 1, y: 1 }, a: 1, z: 1 }, { z: 2, a: 2, m: { y: 2, b: 2 } });
    expect(a.map((e) => e.path)).toEqual(["a", "m.b", "m.y", "z"]);
    expect(b).toEqual(a);
  });

  it("gốc là mảng/nguyên thuỷ: path rỗng; hai bên bằng nhau → không có gì", () => {
    expect(diffJson([1], [2])).toEqual([{ path: "", before: [1], after: [2] }]);
    expect(diffJson(5, 5)).toEqual([]);
    expect(diffJson("a", null)).toEqual([{ path: "", before: "a", after: undefined }]);
  });

  it("khoá lạ như '__proto__' hoặc 'constructor' không làm hỏng kết quả", () => {
    const evil = JSON.parse('{"__proto__": {"x": 1}, "constructor": 2}');
    const out = diffJson(evil, {});
    expect(out.map((e) => e.path)).toEqual(["__proto__.x", "constructor"]);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("không đổi đầu vào", () => {
    const before = { a: { b: [1, 2] } };
    const snap = JSON.stringify(before);
    diffJson(before, { a: { b: [3] } });
    expect(JSON.stringify(before)).toBe(snap);
  });
});
