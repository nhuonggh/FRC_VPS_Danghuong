import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { normalizeSearch, searchTextWhere } from "@/lib/search";
import { prisma, resetDb } from "../helpers/db";
import { makePartner, makeProduct } from "../helpers/factories";

describe("normalizeSearch", () => {
  it.each([
    ["Tôn lạnh màu 0.45", "ton lanh mau 0.45"],
    ["TÔN  LẠNH ", "ton lanh"],
    ["Đặng Hương", "dang huong"],
    ["ĐẶNG HƯƠNG", "dang huong"],
    ["  tôn\txốp\n11 sóng ", "ton xop 11 song"],
    ["Ư Ơ Ê Ô Ă Â", "u o e o a a"],
    ["", ""],
  ])("%j → %j", (input, out) => {
    expect(normalizeSearch(input)).toBe(out);
  });

  it("chuỗi phân rã (dấu kết hợp U+0300–U+036F tách rời) được bỏ dấu", () => {
    expect(normalizeSearch("Tôn lạnh màu")).toBe("ton lanh mau");
    expect(normalizeSearch("̣̀́̂̃̉a")).toBe("a");
  });

  it("mã nguồn dùng escape \\u0300-\\u036f, KHÔNG chứa ký tự kết hợp thô (dễ mất khi soạn/copy)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/search.ts"), "utf8");
    expect(src).toContain("[\\u0300-\\u036f]");
    expect(/[̀-ͯ]/.test(src)).toBe(false);
  });

  it("chuỗi đã ở dạng NFD/NFC khác nhau cho cùng kết quả", () => {
    expect(normalizeSearch("Tôn".normalize("NFD"))).toBe(normalizeSearch("Tôn".normalize("NFC")));
  });
});

describe("searchTextWhere", () => {
  it("rỗng/khoảng trắng → {} (không lọc)", () => {
    expect(searchTextWhere(undefined)).toEqual({});
    expect(searchTextWhere("")).toEqual({});
    expect(searchTextWhere("   ")).toEqual({});
  });
  it("mỗi từ là 1 điều kiện AND (không phụ thuộc thứ tự từ)", () => {
    expect(searchTextWhere("Lạnh TÔN")).toEqual({
      AND: [{ searchText: { contains: "lanh" } }, { searchText: { contains: "ton" } }],
    });
  });
  it("ký tự đại diện LIKE (% _ và dấu \\) được escape thành ký tự thường", () => {
    expect(searchTextWhere("50%")).toEqual({ AND: [{ searchText: { contains: "50\\%" } }] });
    expect(searchTextWhere("a_b")).toEqual({ AND: [{ searchText: { contains: "a\\_b" } }] });
    expect(searchTextWhere("c\\d")).toEqual({ AND: [{ searchText: { contains: "c\\\\d" } }] });
  });
});

describe("tìm trên DB thật (Postgres)", () => {
  beforeEach(resetDb);

  const find = (q: string | undefined) => prisma.product.findMany({ where: searchTextWhere(q), orderBy: { code: "asc" } });
  const codes = async (q: string | undefined) => (await find(q)).map((p) => p.code);

  it("ton lanh / TÔN  LẠNH  / lanh ton / mã đều ra 'Tôn lạnh màu 0.45'; 'xop' không ra", async () => {
    const name = "Tôn lạnh màu 0.45";
    await makeProduct({ code: "TL045", name, searchText: normalizeSearch(name + " TL045") });
    await makeProduct({ code: "TX11", name: "Tôn xốp 11 sóng", searchText: normalizeSearch("Tôn xốp 11 sóng TX11") });
    for (const q of ["ton lanh", "TÔN  LẠNH ", "lanh ton", "tl045", "Tôn lạnh".normalize("NFD")]) {
      expect(await codes(q), q).toEqual(["TL045"]);
    }
    expect(await codes("xop")).toEqual(["TX11"]);
    expect(await codes("ton")).toEqual(["TL045", "TX11"]);
    expect(await codes("khong co")).toEqual([]);
  });

  it("tên có 'đ' tìm được bằng 'd' (Đặng Hương ← dang huong)", async () => {
    await makeProduct({ code: "DH", name: "Đặng Hương", searchText: normalizeSearch("Đặng Hương DH") });
    expect(await codes("dang huong")).toEqual(["DH"]);
    expect(await codes("ĐẶNG")).toEqual(["DH"]);
  });

  it("để trống / chỉ khoảng trắng → trả về tất cả", async () => {
    await makeProduct({ code: "A1" });
    await makeProduct({ code: "A2" });
    await makeProduct({ code: "A3" });
    for (const q of [undefined, "", "   "]) expect(await codes(q), String(q)).toEqual(["A1", "A2", "A3"]);
  });

  it("% và _ do người dùng gõ là ký tự thường, không phải ký tự đại diện", async () => {
    await makeProduct({ code: "P50", searchText: normalizeSearch("Tôn giảm 50% P50") });
    await makeProduct({ code: "P500", searchText: normalizeSearch("Tôn dày 500 P500") });
    await makeProduct({ code: "UND", searchText: normalizeSearch("ma_hang UND") });
    await makeProduct({ code: "UNX", searchText: normalizeSearch("maxhang UNX") });
    await makeProduct({ code: "BSL", searchText: normalizeSearch("thư mục c\\d BSL") });
    await makeProduct({ code: "BSX", searchText: normalizeSearch("thư mục cxd BSX") });

    expect(await codes("50%")).toEqual(["P50"]);
    expect(await codes("%")).toEqual(["P50"]);
    expect(await codes("ma_hang")).toEqual(["UND"]);
    expect(await codes("_")).toEqual(["UND"]);
    expect(await codes("c\\d")).toEqual(["BSL"]);
    expect(await codes("\\")).toEqual(["BSL"]);
  });

  it("dùng được cho bảng khác có cột searchText (Partner)", async () => {
    await makePartner({ code: "KH1", name: "Công ty Đặng Hương", searchText: normalizeSearch("Công ty Đặng Hương KH1") });
    await makePartner({ code: "KH2", name: "Anh Nam", searchText: normalizeSearch("Anh Nam KH2") });
    const rows = await prisma.partner.findMany({ where: searchTextWhere("cong ty dang") });
    expect(rows.map((r) => r.code)).toEqual(["KH1"]);
  });
});
