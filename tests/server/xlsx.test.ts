import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildXlsx, buildXlsxBatched, xlsxResponse } from "@/server/export/xlsx";

async function read(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb.worksheets[0]!;
}

describe("buildXlsx", () => {
  const columns = [
    { header: "Mã", key: "code", width: 12, text: true },
    { header: "Số lượng", key: "qty", numFmt: "#,##0.###" },
    { header: "Tiền", key: "amount", numFmt: '#,##0 "₫"' },
    { header: "Ngày", key: "date" },
  ];

  it("dòng tiêu đề tiếng Việt + dữ liệu; số vẫn là SỐ (không phải chuỗi)", async () => {
    const buf = await buildXlsx("Sản phẩm", columns, [
      { code: "SP1", qty: 1250, amount: "1500000.50", date: new Date("2026-09-30T16:50:00Z") },
    ]);
    const ws = await read(buf);
    expect(ws.name).toBe("Sản phẩm");
    expect(ws.getRow(1).values).toEqual([undefined, "Mã", "Số lượng", "Tiền", "Ngày"]);
    expect(ws.getCell("B2").value).toBe(1250);
    expect(ws.getCell("B2").type).toBe(ExcelJS.ValueType.Number);
    expect(ws.getCell("C2").value).toBe(1500000.5); // chuỗi Decimal → số
    expect(ws.getCell("C2").type).toBe(ExcelJS.ValueType.Number);
    expect(ws.getCell("A2").value).toBe("SP1");
    expect(ws.getCell("D2").text).toBe("30/09/2026"); // ngày theo ICT
  });

  it("định dạng số (numFmt) được áp cho cột; tiêu đề đậm và cố định dòng đầu", async () => {
    const ws = await read(await buildXlsx("S", columns, [{ code: "SP1", qty: 1, amount: 2 }]));
    expect(ws.getCell("B2").numFmt).toBe("#,##0.###");
    expect(ws.getCell("C2").numFmt).toBe('#,##0 "₫"');
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("null/undefined → ô trống (không phải 0)", async () => {
    const ws = await read(await buildXlsx("S", columns, [{ code: "SP1", qty: null, amount: undefined, date: null }]));
    expect(ws.getCell("B2").value).toBeNull();
    expect(ws.getCell("C2").value).toBeNull();
    expect(ws.getCell("D2").value).toBeNull();
  });

  it("số 0 vẫn là 0 (không bị coi là rỗng); NaN/Infinity → ô trống", async () => {
    const ws = await read(await buildXlsx("S", columns, [{ code: "SP1", qty: 0, amount: "0" }, { code: "SP2", qty: NaN, amount: Infinity }]));
    expect(ws.getCell("B2").value).toBe(0);
    expect(ws.getCell("C2").value).toBe(0);
    expect(ws.getCell("B3").value).toBeNull();
    expect(ws.getCell("C3").value).toBeNull();
  });

  describe("chống công thức tiêm nhiễm (= + - @ TAB CR)", () => {
    const evil = ['=HYPERLINK("http://x")', "+cmd|' /C calc'!A0", "-1+1", "@SUM(A1)", "\t=1+1", "\r=1+1"];

    it("cột mã (text) và cột thường: chuỗi nguy hiểm được tiền tố dấu nháy, không thành ô công thức", async () => {
      const ws = await read(await buildXlsx("S", [{ header: "Mã", key: "code", text: true }, { header: "Ghi chú", key: "note" }], evil.map((s) => ({ code: s, note: s }))));
      evil.forEach((s, i) => {
        for (const col of ["A", "B"]) {
          const c = ws.getCell(`${col}${i + 2}`);
          expect(c.type, `${col}${i + 2}`).toBe(ExcelJS.ValueType.String); // không phải Formula
          // XML chuẩn hoá CR → LF khi đọc lại; phần cần kiểm là dấu nháy đứng đầu
          expect(c.value).toBe(`'${s}`.replace(/\r/g, "\n"));
        }
      });
    });

    it("số âm thật (number / chuỗi thập phân) vẫn là SỐ, không bị coi là công thức", async () => {
      const ws = await read(await buildXlsx("S", [{ header: "Tiền", key: "amount" }], [{ amount: -1500.5 }, { amount: "-1500.5" }]));
      expect(ws.getCell("A2").value).toBe(-1500.5);
      expect(ws.getCell("A3").value).toBe(-1500.5);
    });

    it("chuỗi chỉ gồm chữ số có dấu +/- (SĐT quốc tế, số âm dạng chữ ở cột text) không bị thêm dấu nháy", async () => {
      const ws = await read(await buildXlsx("S", [{ header: "SĐT", key: "phone", text: true }], [{ phone: "+84912345678" }, { phone: "-5" }]));
      expect(ws.getCell("A2").value).toBe("+84912345678");
      expect(ws.getCell("A3").value).toBe("-5");
    });

    it("chuỗi thường không bị thêm dấu nháy", async () => {
      const ws = await read(await buildXlsx("S", [{ header: "Tên", key: "name" }], [{ name: "Tôn lạnh 0.45" }, { name: "a=b" }, { name: "x-y" }]));
      expect(ws.getCell("A2").value).toBe("Tôn lạnh 0.45");
      expect(ws.getCell("A3").value).toBe("a=b");
      expect(ws.getCell("A4").value).toBe("x-y");
    });
  });

  it("cột mã (text: true) giữ nguyên số 0 đầu; cột thường đổi chuỗi số thành số", async () => {
    const ws = await read(await buildXlsx("S", [{ header: "Mã", key: "code", text: true }, { header: "Tiền", key: "amount" }], [{ code: "00123", amount: "00123" }]));
    expect(ws.getCell("A2").value).toBe("00123");
    expect(ws.getCell("A2").type).toBe(ExcelJS.ValueType.String);
    expect(ws.getCell("B2").value).toBe(123);
  });

  it("cột text: chuỗi số dài / số điện thoại / mã vạch lưu thành CHỮ, đúng từng chữ số, định dạng '@'", async () => {
    const barcode = "8934567890123456789"; // 19 chữ số: vượt độ chính xác của số thực
    const ws = await read(
      await buildXlsx("S", [{ header: "Mã vạch", key: "code", text: true }, { header: "SĐT", key: "phone", text: true }], [
        { code: barcode, phone: "0912345678" },
        { code: 8934567890123, phone: 912345678 }, // giá trị kiểu number ở cột text vẫn ra chữ
      ]),
    );
    expect(ws.getCell("A2").value).toBe(barcode);
    expect(ws.getCell("A2").type).toBe(ExcelJS.ValueType.String);
    expect(ws.getCell("B2").value).toBe("0912345678");
    expect(ws.getCell("A3").value).toBe("8934567890123");
    expect(ws.getCell("B3").value).toBe("912345678");
    expect(ws.getCell("A2").numFmt).toBe("@");
  });

  it("cột KHÔNG text: chuỗi số quá 15 chữ số giữ nguyên chuỗi (không mất chữ số do số thực)", async () => {
    const big = "12345678901234567890.12";
    const ws = await read(await buildXlsx("S", [{ header: "Số", key: "n" }], [{ n: big }, { n: "999999999999999" }, { n: "1234567.123456" }]));
    expect(ws.getCell("A2").value).toBe(big);
    expect(ws.getCell("A3").value).toBe(999999999999999); // đúng 15 chữ số → số
    expect(ws.getCell("A4").value).toBe(1234567.123456);
  });

  it("Prisma.Decimal (đối tượng có toString) → số", async () => {
    const ws = await read(await buildXlsx("S", [{ header: "Tiền", key: "amount" }], [{ amount: { toString: () => "2500000.75" } }]));
    expect(ws.getCell("A2").value).toBe(2500000.75);
  });

  it("tên sheet không hợp lệ của Excel được làm sạch (ký tự cấm, dài quá 31)", async () => {
    const ws = await read(await buildXlsx("Báo cáo: Tôn/Xốp [Q3]? * " + "x".repeat(40), columns, []));
    expect(ws.name).toHaveLength(31);
    expect(ws.name).not.toMatch(/[\\/*?:[\]]/);
    expect((await read(await buildXlsx("", columns, []))).name).toBe("Sheet1");
  });

  it("làm việc với 5.000 dòng trong thời gian hợp lý", async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ code: `SP${i}`, qty: i, amount: i * 1000, date: new Date() }));
    const t = performance.now();
    const ws = await read(await buildXlsx("S", columns, rows));
    expect(ws.rowCount).toBe(5001);
    expect(performance.now() - t).toBeLessThan(5000);
  });
});

describe("xlsxResponse", () => {
  it("content-type xlsx + tên file UTF-8 (RFC 5987), không cho chèn header", async () => {
    const buf = await buildXlsx("S", [{ header: "A", key: "a" }], [{ a: 1 }]);
    const res = xlsxResponse("Sản phẩm 30-09.xlsx", buf);
    expect(res.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(res.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''S%E1%BA%A3n%20ph%E1%BA%A9m%2030-09.xlsx");
    expect(res.headers.get("cache-control")).toBe("no-store"); // dữ liệu theo quyền/bộ lọc: không được cache
    expect(Buffer.from(await res.arrayBuffer()).equals(buf)).toBe(true);
    const evil = xlsxResponse('a"\r\nSet-Cookie: x=1.xlsx', buf);
    expect(evil.headers.get("content-disposition")).not.toMatch(/[\r\n"]/);
  });
});

describe("buildXlsxBatched (ghi theo lô, không giữ cả workbook trong bộ nhớ)", () => {
  const columns = [
    { header: "Mã", key: "code", width: 12, text: true },
    { header: "Số lượng", key: "qty", numFmt: "#,##0.###" },
    { header: "Tiền", key: "amount", numFmt: '#,##0 "₫"' },
    { header: "Ngày", key: "date" },
  ];
  async function* batches(...bs: Record<string, unknown>[][]) { for (const b of bs) yield b; }
  const evil = ['=HYPERLINK("http://x")', "+cmd|' /C calc'!A0", "-1+1", "@SUM(A1)", "\t=1+1", "\r=1+1"];
  const sample = [
    [{ code: "00123", qty: 1250, amount: "1500000.50", date: new Date("2026-09-30T16:50:00Z") }, { code: "SP2", qty: 0, amount: "0" }],
    [{ code: "SP3", qty: null, amount: undefined, date: null }, { code: "12345678901234567890", qty: NaN, amount: Infinity }, ...evil.map((e) => ({ code: e, qty: e, amount: e }))],
  ];

  it("cho CÙNG giá trị ô, kiểu ô, định dạng như buildXlsx (số, Decimal, text '@', null, NaN, chống công thức)", async () => {
    const a = await read(await buildXlsx("S", columns, sample.flat()));
    const b = await read(await buildXlsxBatched("S", columns, batches(...sample)));
    expect(b.rowCount).toBe(a.rowCount);
    for (let r = 1; r <= a.rowCount; r++) {
      for (let c = 1; c <= columns.length; c++) {
        const x = a.getCell(r, c), y = b.getCell(r, c);
        expect([r, c, y.value, y.type, y.numFmt]).toEqual([r, c, x.value, x.type, x.numFmt]);
      }
    }
    expect(b.getCell("A2").value).toBe("00123");
    expect(b.getColumn(1).numFmt).toBe("@");
  });

  it("tiêu đề đậm, cố định dòng đầu, tên sheet an toàn", async () => {
    const ws = await read(await buildXlsxBatched("A/B:C", columns, batches(sample[0]!)));
    expect(ws.name).toBe("A B C");
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("ghi chú cuối file: gộp ô trên mọi cột, dài tuỳ ý; chỉ khi có ghi chú", async () => {
    let note: string | null = null;
    const ws = await read(await buildXlsxBatched("S", columns, (async function* () { yield sample[0]!; note = "=Ghi chú dài"; })(), { note: () => note }));
    expect(ws.rowCount).toBe(4);
    expect(ws.getCell("A4").value).toBe("'=Ghi chú dài"); // vẫn qua chống công thức
    expect(ws.model.merges).toEqual(["A4:D4"]);
    const none = await read(await buildXlsxBatched("S", columns, batches(sample[0]!), { note: () => null }));
    expect(none.rowCount).toBe(3);
    expect(none.model.merges).toEqual([]);
  });

  it("không có dòng nào: vẫn ra file hợp lệ chỉ có tiêu đề", async () => {
    const ws = await read(await buildXlsxBatched("S", columns, batches()));
    expect(ws.rowCount).toBe(1);
  });

  it("lỗi từ nguồn dữ liệu được ném ra (không treo)", async () => {
    await expect(buildXlsxBatched("S", columns, (async function* () { yield sample[0]!; throw new Error("db down"); })())).rejects.toThrow("db down");
  });
});
