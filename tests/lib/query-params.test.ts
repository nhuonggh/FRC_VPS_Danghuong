import { describe, expect, it } from "vitest";
import { buildExportHref, buildListHref, listTimeRange, parseListParams, sortToOrderBy } from "@/lib/query-params";

describe("parseListParams", () => {
  it("mặc định", () => {
    expect(parseListParams({})).toEqual({ page: 1, pageSize: 20, filters: {} });
  });

  it("đọc page/pageSize/sort/q/time và filter nhiều giá trị nối bằng dấu phẩy", () => {
    const p = parseListParams(
      { page: "3", pageSize: "50", sort: "-createdAt", q: " ton lanh ", timePreset: "thisMonth", status: "active,pending", dept: "5" },
      ["status", "dept"],
    );
    expect(p).toEqual({
      page: 3, pageSize: 50, sort: "-createdAt", q: "ton lanh", timePreset: "thisMonth",
      filters: { status: ["active", "pending"], dept: ["5"] },
    });
  });

  it("giá trị rác → về mặc định (page < 1, pageSize không hợp lệ, preset lạ)", () => {
    const p = parseListParams({ page: "-2", pageSize: "7", timePreset: "hack" });
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(20);
    expect(p.timePreset).toBeUndefined();
    expect(parseListParams({ page: "abc" }).page).toBe(1);
  });

  it("page: 0, số lẻ, dạng mũ/hex, rỗng → 1; số quá lớn bị chặn (skip không tràn Int32 của Prisma)", () => {
    for (const page of ["0", "1.5", "1e2", "0x10", "", " ", "NaN", "Infinity"]) {
      expect(parseListParams({ page }).page, page).toBe(1);
    }
    expect(parseListParams({ page: "999999999999" }).page).toBe(1);
    expect(parseListParams({ page: "1000000" }).page).toBe(1_000_000);
    expect(parseListParams({ page: "1000000" }).page * 100).toBeLessThan(2 ** 31);
    expect(parseListParams({ page: ["2", "9"] }).page).toBe(2); // ?page=2&page=9 → lấy giá trị đầu
  });

  it("pageSize chỉ nhận đúng tập cho phép (10, 15, 20, 50, 100)", () => {
    for (const s of [10, 15, 20, 50, 100]) expect(parseListParams({ pageSize: String(s) }).pageSize).toBe(s);
    for (const s of ["0", "5", "21", "1000", "-10", "abc", "", "20.0e0"]) expect(parseListParams({ pageSize: s }).pageSize, s).toBe(20);
  });

  it("chỉ nhận filter key được khai báo (không nhận key tuỳ ý từ URL)", () => {
    expect(parseListParams({ status: "a", evil: "b" }, ["status"]).filters).toEqual({ status: ["a"] });
    expect(parseListParams({ status: "a", evil: "b" }).filters).toEqual({});
    expect(parseListParams({ __proto__: "x", constructor: "y" } as never, ["status"]).filters).toEqual({});
  });

  it("mảng (?a=1&a=2) được gộp; giá trị rỗng/khoảng trắng bị bỏ", () => {
    expect(parseListParams({ status: ["a", "b"] }, ["status"]).filters).toEqual({ status: ["a", "b"] });
    expect(parseListParams({ status: " a , ,b,, " }, ["status"]).filters).toEqual({ status: ["a", "b"] });
    expect(parseListParams({ status: "" }, ["status"]).filters).toEqual({});
  });

  it("sort: chỉ nhận dạng 'tên' hoặc '-tên' (chữ, số, gạch dưới); còn lại bị bỏ", () => {
    expect(parseListParams({ sort: "name" }).sort).toBe("name");
    expect(parseListParams({ sort: "-createdAt" }).sort).toBe("-createdAt");
    for (const sort of ["--name", "name;drop", "na me", "-", "a.b", "{\"a\":1}", "x".repeat(65), "1abc"]) {
      expect(parseListParams({ sort }).sort, sort).toBeUndefined();
    }
  });

  it("q: cắt khoảng trắng, giới hạn 200 ký tự, rỗng → không có", () => {
    expect(parseListParams({ q: "   " }).q).toBeUndefined();
    expect(parseListParams({ q: "a".repeat(500) }).q).toHaveLength(200);
  });

  it("timeStart/timeEnd chỉ nhận 'yyyy-mm-dd' hợp lệ", () => {
    const p = parseListParams({ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-02-30" });
    expect(p.timeStart).toBe("2026-09-01");
    expect(p.timeEnd).toBeUndefined();
    expect(parseListParams({ timeStart: "hôm qua" }).timeStart).toBeUndefined();
  });
});

describe("buildListHref — bỏ khoá khi = mặc định", () => {
  const base = parseListParams({ q: "abc", status: "a,b", sort: "-name", page: "4" }, ["status"]);

  it("đổi page giữ nguyên các query khác", () => {
    expect(buildListHref("/x", base, { page: 5 })).toBe("/x?q=abc&status=a%2Cb&sort=-name&page=5");
  });
  it("page=1 và pageSize mặc định không lên URL", () => {
    expect(buildListHref("/x", base, { page: 1 })).toBe("/x?q=abc&status=a%2Cb&sort=-name");
    expect(buildListHref("/x", base, { pageSize: 20 })).toBe("/x?q=abc&status=a%2Cb&sort=-name");
    expect(buildListHref("/x", parseListParams({}), {})).toBe("/x");
  });
  it("đổi bộ lọc/tìm kiếm/sort/thời gian → reset về trang 1", () => {
    expect(buildListHref("/x", base, { q: "mới" })).toBe("/x?q=m%E1%BB%9Bi&status=a%2Cb&sort=-name");
    expect(buildListHref("/x", base, { sort: undefined })).toBe("/x?q=abc&status=a%2Cb");
    expect(buildListHref("/x", base, { sort: "code" })).toBe("/x?q=abc&status=a%2Cb&sort=code");
    expect(buildListHref("/x", base, { filters: { status: [] } })).toBe("/x?q=abc&sort=-name");
    expect(buildListHref("/x", base, { filters: { status: ["c"] } })).toBe("/x?q=abc&status=c&sort=-name");
    expect(buildListHref("/x", base, { timePreset: "today" })).toBe("/x?q=abc&status=a%2Cb&sort=-name&timePreset=today");
    expect(buildListHref("/x", base, { timeStart: "2026-09-01" })).toBe("/x?q=abc&status=a%2Cb&sort=-name&timeStart=2026-09-01");
    expect(buildListHref("/x", base, { timeEnd: "2026-09-30" })).toBe("/x?q=abc&status=a%2Cb&sort=-name&timeEnd=2026-09-30");
  });
  it("đổi cỡ trang reset về trang 1", () => {
    expect(buildListHref("/x", base, { pageSize: 50 })).toBe("/x?q=abc&status=a%2Cb&sort=-name&pageSize=50");
  });
  it("mỗi loại thay đổi từ trang 4 đều về trang 1 (không có 'page=' trong URL)", () => {
    const patches = [
      { q: "z" }, { q: undefined }, { sort: "code" }, { sort: undefined }, { timePreset: "thisWeek" as const },
      { timeStart: "2026-01-01" }, { timeEnd: "2026-01-31" }, { filters: { status: ["z"] } }, { filters: { status: [] } },
      { pageSize: 50 }, { pageSize: 20 },
    ];
    for (const patch of patches) expect(buildListHref("/x", base, patch), JSON.stringify(patch)).not.toContain("page=");
  });
  it("đổi bộ lọc VÀ chỉ định page tường minh → page tường minh thắng; không đổi gì thì giữ nguyên trang", () => {
    expect(buildListHref("/x", base, { q: "z", page: 2 })).toBe("/x?q=z&status=a%2Cb&sort=-name&page=2");
    expect(buildListHref("/x", base, {})).toBe("/x?q=abc&status=a%2Cb&sort=-name&page=4");
  });
  it("patch không đổi base (không mutate)", () => {
    const snapshot = JSON.stringify(base);
    buildListHref("/x", base, { filters: { status: [], other: ["1"] }, q: "k", page: 9 });
    expect(JSON.stringify(base)).toBe(snapshot);
  });
  it("giá trị patch không hợp lệ bị chặn: pageSize ngoài tập cho phép bị bỏ qua, page < 1 thành 1", () => {
    expect(buildListHref("/x", base, { pageSize: 7 })).toBe("/x?q=abc&status=a%2Cb&sort=-name&page=4");
    expect(buildListHref("/x", base, { page: 0 })).toBe("/x?q=abc&status=a%2Cb&sort=-name");
    expect(buildListHref("/x", base, { page: -3 })).toBe("/x?q=abc&status=a%2Cb&sort=-name");
    expect(buildListHref("/x", base, { page: 2.7 })).toBe("/x?q=abc&status=a%2Cb&sort=-name&page=2");
  });
  it("round-trip: URL dựng ra được parseListParams đọc lại đúng", () => {
    const href = buildListHref("/x", base, { pageSize: 50, timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15", page: 2 });
    const sp = Object.fromEntries(new URL(href, "http://h").searchParams);
    expect(parseListParams(sp, ["status"])).toEqual({
      page: 2, pageSize: 50, q: "abc", sort: "-name", timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15",
      filters: { status: ["a", "b"] },
    });
  });
});

describe("buildExportHref — export dùng ĐÚNG bộ lọc đang xem, không phân trang", () => {
  it("giữ q/filter/sort/thời gian; bỏ page và pageSize", () => {
    const p = parseListParams(
      { q: "ton", status: "a,b", sort: "-name", timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15", page: "7", pageSize: "50" },
      ["status"],
    );
    const href = buildExportHref("/api/products/export", p);
    expect(href).toBe("/api/products/export?q=ton&status=a%2Cb&sort=-name&timePreset=custom&timeStart=2026-09-01&timeEnd=2026-09-15");
    // route export đọc lại bằng chính parseListParams → cùng where-clause với trang danh sách
    const back = parseListParams(Object.fromEntries(new URL(href, "http://h").searchParams), ["status"]);
    expect({ ...back, page: p.page, pageSize: p.pageSize }).toEqual(p);
  });
  it("không có filter nào → đường dẫn trần", () => {
    expect(buildExportHref("/api/x/export", parseListParams({ page: "3" }))).toBe("/api/x/export");
  });
});

describe("listTimeRange", () => {
  const NOW = new Date("2026-09-30T16:50:00Z");
  it("không chọn mốc → null (không lọc thời gian)", () => {
    expect(listTimeRange(parseListParams({}), NOW)).toBeNull();
  });
  it("mốc cố định → khoảng nửa mở theo ICT", () => {
    const r = listTimeRange(parseListParams({ timePreset: "thisMonth" }), NOW)!;
    expect([r.start.toISOString(), r.end.toISOString()]).toEqual(["2026-08-31T17:00:00.000Z", "2026-09-30T17:00:00.000Z"]);
  });
  it("Tùy chọn hợp lệ → gồm cả ngày kết thúc; thiếu/đảo ngược → null (không lọc)", () => {
    const ok = listTimeRange(parseListParams({ timePreset: "custom", timeStart: "2026-09-01", timeEnd: "2026-09-15" }), NOW)!;
    expect([ok.start.toISOString(), ok.end.toISOString()]).toEqual(["2026-08-31T17:00:00.000Z", "2026-09-15T17:00:00.000Z"]);
    expect(listTimeRange(parseListParams({ timePreset: "custom", timeStart: "2026-09-01" }), NOW)).toBeNull();
    expect(listTimeRange(parseListParams({ timePreset: "custom", timeStart: "2026-09-15", timeEnd: "2026-09-01" }), NOW)).toBeNull();
  });
});

describe("sortToOrderBy", () => {
  it("chỉ nhận cột nằm trong danh sách cho phép", () => {
    expect(sortToOrderBy("-name", ["name", "code"], { id: "desc" })).toEqual({ name: "desc" });
    expect(sortToOrderBy("code", ["name", "code"], { id: "desc" })).toEqual({ code: "asc" });
    expect(sortToOrderBy("passwordHash", ["name"], { id: "desc" })).toEqual({ id: "desc" });
    expect(sortToOrderBy("-passwordHash", ["name"], { id: "desc" })).toEqual({ id: "desc" });
    expect(sortToOrderBy(undefined, ["name"], { id: "desc" })).toEqual({ id: "desc" });
    expect(sortToOrderBy("", ["name"], { id: "desc" })).toEqual({ id: "desc" });
  });
  it("khoá đặc biệt (__proto__, constructor, toString) không lọt qua danh sách cho phép", () => {
    for (const s of ["__proto__", "-__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(sortToOrderBy(s, ["name"], { id: "desc" }), s).toEqual({ id: "desc" });
    }
  });
  it("kết quả đi qua parseListParams + sortToOrderBy: URL độc hại về mặc định", () => {
    const p = parseListParams({ sort: "-passwordHash;--" });
    expect(sortToOrderBy(p.sort, ["name"], { id: "desc" })).toEqual({ id: "desc" });
  });
});
