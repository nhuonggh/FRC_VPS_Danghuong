import { describe, expect, it } from "vitest";
import { legacyDate, parseLegacySales, parseTerms } from "@/server/legacy-import/parse";

const head = "<tr><th>Stt</th><th>Ngày</th><th>Nhóm khách hàng</th><th>Khách hàng</th><th>Địa chỉ</th><th>Số điện thoại</th><th>Đơn hàng</th><th>Nội dung</th></tr>";
const td = (...c: string[]) => `<tr>${c.map((x) => `<td>${x}</td>`).join("")}</tr>`;
// dòng đầu đơn: 23 ô; dòng hàng tiếp theo: 10 ô
const first = (code: string, ...line: string[]) => td("1", "29/10/2026", "NHÓM THỢ", "Anh Nhật", "--&gt; xóm Bắp", "0963682596 - 0393890302", code, ...line, "0", "0", "4,511,000", "0", "4,511,000", "");
const html = `<table>${head}${first("ORD_1", "Hộp mạ kẽm 30*60*1.1", "", "8", "1", "8 * 1", "1", "8", "Cây", "169,000", "1,352,000")}${td("Tôn Hoa Sen 0.35 màu xám - Tôn xốp,11 sóng", "Tôn xốp,11 sóng", "4.5*1.08 7.9*1.08", "1", "x", "1", "21.924", "m2", "124,000", "2,718,576")}${td("Tổng", "1", "2", "3")}</table>`;

describe("đọc báo cáo bán hàng phần mềm cũ", () => {
  it("tách đơn, dòng hàng, SĐT, bỏ hậu tố kiểu gia công và đọc số hạng m²", () => {
    const { orders, errors } = parseLegacySales(html);
    expect(errors).toEqual([]);
    expect(orders).toHaveLength(1);
    const o = orders[0]!;
    expect(o).toMatchObject({ code: "ORD_1", date: "2026-10-29", group: "NHÓM THỢ", customer: "Anh Nhật", address: "--> xóm Bắp", total: 4_511_000, paid: 0, debt: 4_511_000 });
    expect(o.phones).toEqual(["0963682596", "0393890302"]);
    expect(o.lines).toHaveLength(2);
    expect(o.lines[0]).toMatchObject({ name: "Hộp mạ kẽm 30*60*1.1", unit: "Cây", qty: 8, price: 169_000, terms: null });
    expect(o.lines[1]).toMatchObject({ name: "Tôn Hoa Sen 0.35 màu xám", kind: "Tôn xốp,11 sóng", unit: "m2", qty: 21.924, price: 124_000 });
    expect(o.lines[1]!.terms).toEqual([{ length: 4.5, ratio: 1.08, pieces: 1 }, { length: 7.9, ratio: 1.08, pieces: 1 }]);
  });

  it("SĐT có gạch ngang giữa các số không bị tách", () => {
    expect(parseLegacySales(html.replace("0963682596 - 0393890302", "035-7952-332")).orders[0]!.phones).toEqual(["035-7952-332"]);
  });

  it("tệp không đúng loại ⇒ báo lỗi, không có đơn", () => {
    const r = parseLegacySales("<table><tr><td>abc</td></tr></table>");
    expect(r.orders).toEqual([]);
    expect(r.errors[0]).toMatch(/Báo cáo bán hàng/);
  });

  it("ngày và biểu thức số hạng", () => {
    expect(legacyDate("29/10/2026")).toBe("2026-10-29");
    expect(legacyDate("31/02/2026")).toBeNull();
    expect(parseTerms("4.5*1.08*3")).toEqual([{ length: 4.5, ratio: 1.08, pieces: 3 }]);
    expect(parseTerms("12")).toBeNull();
    expect(parseTerms("")).toBeNull();
  });
});
