/**
 * Tạo "Bảng bổ sung dữ liệu" gửi khách: điền sẵn mã/tên từ dữ liệu đã nhận (bảng nhập + file phần mềm cũ),
 * khách chỉ điền phần còn thiếu. Mỗi trang dữ liệu có đúng tên cột của mẫu nhập Excel trong hệ thống.
 *
 *   npx tsx scripts/build-customer-supplement.ts --intake <xlsx> --legacy <xls> --out <xlsx>
 */
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { buildProductRows, parseLegacyExport, readIntake, type Row } from "./lib/customer-data";

const args = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const [intakePath, legacyPath, outPath] = [arg("intake"), arg("legacy"), arg("out")];
if (!intakePath || !legacyPath || !outPath) throw new Error("Thiếu --intake, --legacy, --out.");

const NAVY = "FF1F3A5F"; const REQ = "FFC0392B"; const NOTE_BG = "FFFFF4D6"; const FILL_BG = "FFEAF3FF";
const isExample = (r: Row) => String(r[0] ?? "").trim().startsWith("#");
const data = (rows: Row[] | undefined) => (rows ?? []).slice(1).filter((r) => !isExample(r));

function table(wb: ExcelJS.Workbook, name: string, intro: string, headers: { h: string; w: number; required?: boolean; list?: string[]; text?: boolean }[], rows: Row[], blankRows = 30) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 2 }] });
  ws.mergeCells(1, 1, 1, Math.max(headers.length, 4)); const intro1 = ws.getCell(1, 1); intro1.value = intro; intro1.alignment = { wrapText: true, vertical: "top" }; intro1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NOTE_BG } }; ws.getRow(1).height = 62;
  const head = ws.getRow(2); headers.forEach((c, i) => { const cell = head.getCell(i + 1); cell.value = c.h; cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: c.required ? REQ : NAVY } }; cell.alignment = { vertical: "middle", wrapText: true }; ws.getColumn(i + 1).width = c.w; if (c.text) ws.getColumn(i + 1).numFmt = "@"; });
  head.height = 32;
  rows.forEach((r) => ws.addRow(r.map((v) => v ?? null)));
  const last = 2 + rows.length + blankRows;
  headers.forEach((c, i) => { if (c.list) for (let row = 3; row <= last; row++) ws.getCell(row, i + 1).dataValidation = { type: "list", allowBlank: true, formulae: [`"${c.list.join(",")}"`] }; });
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: headers.length } };
  return ws;
}
const shadeFilled = (ws: ExcelJS.Worksheet, cols: number[], from: number, to: number) => { for (let r = from; r <= to; r++) for (const c of cols) ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_BG } }; };

async function main() {
  const sheets = await readIntake(intakePath!); const legacy = parseLegacyExport(readFileSync(legacyPath!, "utf8"));
  const products = buildProductRows(data(sheets["Sản phẩm"]).map((r) => r.slice(0, 10)), legacy);
  const wb = new ExcelJS.Workbook(); wb.creator = "Phần mềm Đặng Hương";
  const partners = (s: string) => data(sheets[s]).map((r) => r.slice(0, 9));
  const customers = partners("Khách hàng"); const suppliers = partners("Nhà cung cấp");
  const prodCount = products.rows.length;
  const gc = [...new Set(data(sheets["Kiểu gia công"]).filter((r) => String(r[0]).trim() !== "Kiểu gia công").map((r) => String(r[0]).trim()))];

  // ── Hướng dẫn + tổng hợp
  const guide = wb.addWorksheet("HƯỚNG DẪN"); guide.getColumn(1).width = 6; guide.getColumn(2).width = 34; guide.getColumn(3).width = 70; guide.getColumn(4).width = 16; guide.getColumn(5).width = 18;
  guide.mergeCells("A1:E1"); guide.getCell("A1").value = "BẢNG BỔ SUNG DỮ LIỆU — XƯỞNG TÔN ĐẶNG HƯƠNG"; guide.getCell("A1").font = { bold: true, size: 15, color: { argb: NAVY } };
  const lines = ["Đã nhận từ bên anh/chị: 8 danh mục nền, thông tin công ty, 5 người dùng, 19 khách hàng, 6 nhà cung cấp, 133 sản phẩm (bảng nhập) và 1.073 sản phẩm (phần mềm cũ).", "Đã nạp vào phần mềm: tất cả các mục trên. CHƯA nạp: số đầu kỳ (tồn kho, công nợ, quỹ, chiết khấu) vì chưa có ngày chốt, và định mức (BOM).", "Cách điền: điền theo thứ tự các trang. Ô tiêu đề màu ĐỎ = bắt buộc. Ô nền xanh nhạt là dữ liệu đã có sẵn — chỉ sửa nếu sai. Số tiền nhập kiểu Việt Nam (12.500.000 hoặc 1.234,5).", "KHÔNG đổi tên trang, KHÔNG đổi tên/thứ tự cột dòng tiêu đề, KHÔNG chèn cột. Điền xong gửi lại file này."];
  lines.forEach((t, i) => { guide.mergeCells(3 + i, 1, 3 + i, 5); const c = guide.getCell(3 + i, 1); c.value = t; c.alignment = { wrapText: true, vertical: "top" }; guide.getRow(3 + i).height = 34; });
  const rows: (string | number)[][] = [["#", "Trang", "Việc cần làm", "Số dòng điền sẵn", "Mức ưu tiên"],
    [1, "Xác nhận chung", "Điền Ngày chốt số đầu kỳ và trả lời các câu hỏi (cột D).", 18, "BẮT BUỘC"],
    [2, "Phân loại sản phẩm", "Chọn đúng loại cho từng sản phẩm (Hàng hóa / Nguyên vật liệu / Thành phẩm / Phụ kiện), đánh dấu tôn cuộn, ngừng bán, định mức tồn.", prodCount, "BẮT BUỘC"],
    [3, "Khách hàng", "Sửa số điện thoại/địa chỉ (hiện đang là số mẫu 0000, 1111…) và bổ sung các khách còn thiếu.", customers.length, "BẮT BUỘC"],
    [4, "Nhà cung cấp", "Bổ sung điện thoại/địa chỉ và các NCC còn thiếu.", suppliers.length, "NÊN CÓ"],
    [5, "Tồn kho đầu kỳ", "Số lượng và giá vốn theo đơn vị gốc, tại ngày chốt (chỉ điền mã có tồn).", prodCount, "BẮT BUỘC"],
    [6, "Công nợ đầu kỳ", "Số dư tại ngày chốt: khách nợ mình = số dương, mình nợ NCC = số âm.", customers.length + suppliers.length, "BẮT BUỘC"],
    [7, "Số dư quỹ đầu kỳ", "Số dư tiền mặt và từng tài khoản ngân hàng tại ngày chốt (bảng cũ ghi 100.000.000 cho cả 3 quỹ — xác nhận hoặc sửa).", 3, "BẮT BUỘC"],
    [8, "Chiết khấu tích lũy", "Số tiền xưởng còn nợ khách tại ngày chốt (cột C đã có số gửi lần trước — xác nhận hoặc sửa ở cột D).", customers.length, "BẮT BUỘC"],
    [9, "Định mức (BOM)", "Với mỗi cặp Thành phẩm × Kiểu gia công: điền Mã nguyên vật liệu, định mức / 1 đơn vị, ngày hiệu lực. 1 thành phẩm nhiều NVL ⇒ thêm dòng.", 0, "BẮT BUỘC (để bán tôn xốp)"],
    [10, "Giá công gia công thuê", "Đơn giá công từng kiểu gia công và có trừ tôn cuộn của khách đưa hay không.", gc.length, "NÊN CÓ"],
    [11, "Người dùng", "Vị trí của từng người, thêm nhân viên còn thiếu (bán hàng, thủ kho…).", 5, "BẮT BUỘC"],
    [12, "Mẫu in", "Gửi file Google Doc mẫu cho từng loại phiếu + logo/QR.", 9, "NÊN CÓ"]];
  rows.forEach((r, i) => { const row = guide.getRow(8 + i); r.forEach((v, j) => { const c = row.getCell(j + 1); c.value = v; c.alignment = { wrapText: true, vertical: "top" }; if (i === 0) { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } }; } }); });

  // ── Xác nhận chung
  const qa: Row[] = [
    ["Ngày chốt số đầu kỳ (dd/mm/yyyy)", "Mọi số đầu kỳ (tồn, công nợ, quỹ, chiết khấu) phải tại CÙNG một ngày. Bảng cũ để trống.", null],
    ["Số điện thoại khách đã gửi (0000, 1111, 2222…), hạn mức 50.000.000, số dư quỹ 100.000.000 ×3, chiết khấu 19 khách có phải số THẬT?", "Trông như số mẫu để thử. Nếu mẫu: sẽ nạp bản thật ở các trang sau.", null],
    ["Số tài khoản: trang Công ty ghi MB 2318189999; trang Ngân hàng & quỹ ghi MB 12345 và Agribank 6789. Số nào đúng?", "Số 12345 / 6789 trông như số mẫu.", null],
    ["Danh sách khách hàng/NCC chỉ có 19 khách + 6 NCC. Có danh sách đầy đủ không? (từ phần mềm cũ Niềm Tin)", "Gửi file xuất từ phần mềm cũ, có thể nhập hàng ngàn khách một lần.", null],
    ["Sản phẩm: bảng nhập có 133 mã (SP00001…), phần mềm cũ có 1.073 mã. 20 sản phẩm trùng tên — giữ mã SP của bảng nhập, bỏ mã cũ?", "Mặc định: giữ bản bảng nhập (có phân loại), ghi giá cũ vào Ghi chú.", null],
    ["Sản phẩm từ phần mềm cũ hiện nhập hết là “Hàng hóa” (phần mềm cũ ghi chung Hàng hóa + NVL). Anh/chị phân loại lại ở trang “Phân loại sản phẩm”.", "Thành phẩm/Phụ kiện mới khai báo được định mức; NVL mới nhập ở “Tồn NVL đầu kỳ”.", null],
    ["Đơn vị gốc không thống nhất: md / m / mét; cây / Cây; M2; Kg. Chốt một cách ghi cho mỗi loại hàng?", "Tồn kho và giá vốn luôn tính theo đơn vị gốc nên cần đúng.", null],
    ["Định mức tồn của 133 sản phẩm trong bảng nhập đều = 5. Đúng ý (cảnh báo khi dưới 5) hay là giá trị mặc định?", "Nếu không có định mức thật nên để 0 (không cảnh báo).", null],
    ["Mỗi kiểu gia công (Tôn xốp 6S, Meka…) có “Tỷ lệ” và “Tỷ lệ trừ kho”. Phần mềm mới không tự nhân theo tỷ lệ — công thức nằm ở Định mức (BOM). Xác nhận cách hiểu: 1 m tôn xốp 6S bán ra = bao nhiêu m² tôn + bao nhiêu m² xốp?", "Điền ở trang “Định mức (BOM)”.", null],
    ["Tôn cuộn: sản phẩm nào là tôn cuộn (để tra cứu cuộn)?", "Đánh dấu ở trang “Phân loại sản phẩm”, cột Tôn cuộn.", null],
    ["Công thức giá thành sản xuất phụ kiện: chỉ cộng giá NVL, hay cộng cả nhân công/chi phí khác?", "Mặc định hiện tại: chỉ cộng NVL.", null],
    ["Gia công thuê (khách đưa tôn): đúng là KHÔNG trừ tôn cuộn trong kho? Bảng giá công điền ở trang “Giá công gia công thuê”.", "Đã chốt trong tài liệu: không trừ tôn cuộn của khách.", null],
    ["Bùi Thị Lan (tên đăng nhập Lan): vị trí là gì? Còn ai cần tài khoản (bán hàng, thủ kho, giám đốc)?", "Điền ở trang “Người dùng”. Chưa có vị trí nên chưa tạo tài khoản Lan.", null],
    ["Người phụ trách trong bảng khách là “Nhâm”, “Phượng” — khớp tài khoản Nham, Phuong. Đúng không?", "Khách chỉ hiện với người phụ trách (nếu người đó không có quyền xem tất cả khách).", null],
    ["Người ký trên phiếu in: “khách hàng, lái xe, kế toán bán hàng (tên tài khoản đăng nhập)”. Muốn hiện những chữ ký nào trên từng loại phiếu?", "Cấu hình ở Hệ thống → Công ty & mẫu in.", null],
    ["Chân phiếu: nội dung 3 dòng “Lưu ý…” đã nhận. Dùng cho mọi loại phiếu hay chỉ hóa đơn bán hàng?", "Mặc định: chỉ hóa đơn bán hàng và phiếu giao.", null],
    ["Xe và lái xe: 5 xe, 8 lái xe/phụ xe (Bùi Văn Huỳnh, Bùi Đức Xuân, Bùi Văn Đạt là phụ xe). Còn thiếu ai không?", "", null],
    ["Có bảng giá bán theo nhóm khách (Đại lý / Thợ / Bán lẻ) không? Hiện phần mềm lấy giá bán gần nhất theo từng khách.", "Nếu cần bảng giá theo nhóm: báo để làm thêm chức năng.", null],
  ];
  const qs = table(wb, "Xác nhận chung", "Điền trả lời vào cột D (Trả lời của khách). Dòng 1: ghi ngày chốt số đầu kỳ.", [{ h: "#", w: 5 }, { h: "Câu hỏi", w: 80, required: true }, { h: "Gợi ý của phần mềm", w: 52 }, { h: "Trả lời của khách", w: 50, required: true }], qa.map((r, i) => [i + 1, r[0] ?? null, r[1] ?? null, null]), 0);
  qs.eachRow((row, n) => { if (n > 2) { row.alignment = { wrapText: true, vertical: "top" }; row.height = 48; } });

  // ── Phân loại sản phẩm
  const kinds = ["Hàng hóa", "Nguyên vật liệu", "Thành phẩm", "Phụ kiện"]; const yesNo = ["Có", "Không"];
  const prodRows = products.rows.map((r) => [r[0], r[1], r[3], r[2], null, r[7], r[8], r[4], r[9]] as Row);
  const pw = table(wb, "Phân loại sản phẩm", "Chỉ điền các cột D–H khi KHÁC với hiện tại. “Loại đúng”: Hàng hóa / Nguyên vật liệu / Thành phẩm / Phụ kiện. Thành phẩm/Phụ kiện mới khai báo được định mức; Nguyên vật liệu nhập tồn ở “Tồn kho đầu kỳ”. Giá cũ (nếu có) nằm ở cột Ghi chú.",
    [{ h: "Mã", w: 18 }, { h: "Tên", w: 52 }, { h: "Đơn vị gốc", w: 12 }, { h: "Loại hiện tại", w: 16 }, { h: "Loại đúng", w: 18, required: true, list: kinds }, { h: "Tôn cuộn", w: 11, list: yesNo }, { h: "Ngừng bán", w: 11, list: yesNo }, { h: "Định mức tồn", w: 13 }, { h: "Ghi chú", w: 50 }], prodRows, 0);
  shadeFilled(pw, [1, 2, 3, 4, 9], 3, 2 + prodRows.length);

  // ── Khách hàng / NCC
  const pHeaders = [{ h: "Mã", w: 12, required: true }, { h: "Tên", w: 34, required: true }, { h: "Nhóm", w: 18, required: true, list: (data(sheets["Nhóm khách hàng"]).map((r) => String(r[0]).trim())) }, { h: "Điện thoại", w: 16, text: true }, { h: "Địa chỉ", w: 34 }, { h: "Hạn mức nợ", w: 16 }, { h: "Cho ghi nợ", w: 12, list: yesNo }, { h: "Người phụ trách", w: 18 }, { h: "Ghi chú", w: 28 }];
  const cw = table(wb, "Khách hàng", "Sửa trực tiếp số điện thoại/địa chỉ/hạn mức; thêm khách mới ở dòng dưới (Mã duy nhất, chỉ chữ không dấu, số và . _ -). Cột “Người phụ trách” = tên đăng nhập (Nham, Phuong…) hoặc họ tên.", pHeaders, customers, 200);
  shadeFilled(cw, [1, 2, 3, 5, 6, 7, 8], 3, 2 + customers.length);
  table(wb, "Nhà cung cấp", "Bổ sung điện thoại/địa chỉ và các nhà cung cấp còn thiếu.", pHeaders.map((h) => (h.h === "Nhóm" ? { ...h, list: ["Nhà cung cấp"] } : h)), suppliers, 100);

  // ── Số đầu kỳ
  const sw = table(wb, "Tồn kho đầu kỳ", "Chỉ điền số lượng + giá vốn cho mã đang CÓ TỒN tại ngày chốt (mã không có tồn để trống). Số lượng và giá vốn theo ĐƠN VỊ GỐC (cột C). Giá vốn là giá nhập bình quân/lô còn tồn, chưa gồm VAT.",
    [{ h: "Mã", w: 18 }, { h: "Tên", w: 52 }, { h: "Đơn vị gốc", w: 12 }, { h: "Số lượng", w: 16, required: true }, { h: "Giá vốn / đơn vị gốc", w: 20, required: true }], products.rows.map((r) => [r[0], r[1], r[3], null, null] as Row), 0);
  shadeFilled(sw, [1, 2, 3], 3, 2 + prodRows.length);
  const debtRows: Row[] = [...customers.map((r) => [r[0], r[1], "Khách hàng", null] as Row), ...suppliers.map((r) => [r[0], r[1], "Nhà cung cấp", null] as Row)];
  shadeFilled(table(wb, "Công nợ đầu kỳ", "Số dư tại ngày chốt. Khách nợ mình: số DƯƠNG. Mình nợ NCC: số ÂM (ví dụ -5.000.000). Không nợ: để trống hoặc 0.", [{ h: "Mã đối tác", w: 14 }, { h: "Tên", w: 36 }, { h: "Loại", w: 16 }, { h: "Số dư (+ khách nợ, − mình nợ)", w: 28, required: true }], debtRows, 50), [1, 2, 3], 3, 2 + debtRows.length);
  const funds = data(sheets["Ngân hàng & quỹ"]).map((r) => r.slice(0, 3));
  const cashPrev = new Map(data(sheets["Số dư quỹ đầu kỳ"]).map((r) => [String(r[0]).trim(), r[1]]));
  shadeFilled(table(wb, "Số dư quỹ đầu kỳ", "Số dư thực tế tại ngày chốt của từng quỹ/tài khoản. Cột C là số bảng cũ đã ghi (100.000.000 cho cả 3) — nhập số đúng vào cột D.", [{ h: "Tên quỹ / tài khoản", w: 36 }, { h: "Loại", w: 16 }, { h: "Số gửi lần trước", w: 18 }, { h: "Số dư tại ngày chốt", w: 22, required: true }], funds.map((f) => [String(f[0]).trim(), f[1] ?? null, cashPrev.get(String(f[0]).trim()) ?? null, null]), 10), [1, 2, 3], 3, 2 + funds.length);
  const disc = new Map(data(sheets["Chiết khấu tích lũy"]).map((r) => [String(r[0]).trim(), r[1]]));
  shadeFilled(table(wb, "Chiết khấu tích lũy", "Số tiền xưởng CÒN NỢ khách (chiết khấu tích lũy chưa tất toán) tại ngày chốt. Không âm. Cột C là số bảng cũ đã ghi — nhập số xác nhận vào cột D.", [{ h: "Mã khách hàng", w: 16 }, { h: "Tên", w: 36 }, { h: "Số gửi lần trước", w: 18 }, { h: "Chiết khấu còn nợ khách", w: 26, required: true }], customers.map((r) => [r[0], r[1], disc.get(String(r[0]).trim()) ?? null, null]), 100), [1, 2, 3], 3, 2 + customers.length);

  // ── BOM: các cặp (thành phẩm, kiểu gia công) từ phần mềm cũ
  const nameByCode = new Map(products.rows.map((r) => [String(r[0]), String(r[1])]));
  const bomRows: Row[] = legacy.processing.filter((g) => products.codeByLegacyId.has(g.productLegacyId)).map((g) => { const code = products.codeByLegacyId.get(g.productLegacyId)!; return [code, nameByCode.get(code) ?? null, g.name, null, null, null, `PM cũ: ×${g.ratio} ${g.unit}, trừ kho ×${g.stockRatio}`]; });
  shadeFilled(table(wb, "Định mức (BOM)", "Mỗi dòng = 1 nguyên vật liệu của 1 thành phẩm theo 1 kiểu gia công. Điền Mã NVL (mã trong trang Phân loại sản phẩm), Định mức / 1 đơn vị thành phẩm, Ngày hiệu lực. Thành phẩm cần nhiều NVL (tôn + xốp…): chép thêm dòng, giữ nguyên 2 cột đầu. Các cặp bên dưới lấy từ phần mềm cũ (cột G là tỷ lệ cũ để tham khảo); thành phẩm phải có Loại = Thành phẩm/Phụ kiện.",
    [{ h: "Mã thành phẩm", w: 18 }, { h: "Tên thành phẩm", w: 44 }, { h: "Kiểu gia công", w: 22 }, { h: "Ngày hiệu lực (dd/mm/yyyy)", w: 22, required: true }, { h: "Mã nguyên vật liệu", w: 20, required: true }, { h: "Định mức / 1 đơn vị thành phẩm", w: 24, required: true }, { h: "Ghi chú (tỷ lệ cũ, mùa, độ dày…)", w: 40 }], bomRows, 100), [1, 2, 3, 7], 3, 2 + bomRows.length);

  // ── Giá công
  table(wb, "Giá công gia công thuê", "Gia công thuê: khách đưa tôn, xưởng chỉ lấy công. Điền đơn giá công cho từng kiểu và cho biết có trừ tôn cuộn trong kho hay không (mặc định: KHÔNG trừ).", [{ h: "Kiểu gia công", w: 30 }, { h: "Đơn giá công", w: 18, required: true }, { h: "ĐVT tính công", w: 16 }, { h: "Có trừ tôn cuộn trong kho?", w: 26, list: yesNo }, { h: "Ghi chú", w: 30 }], gc.map((n) => [n, null, null, "Không", null]), 30);

  // ── Người dùng
  const roles = ["Giám đốc", "Kế toán", "Thủ quỹ", "Thủ kho", "Bán hàng"]; const userRows = data(sheets["Người dùng"]).map((r) => r.slice(0, 4));
  shadeFilled(table(wb, "Người dùng", "Vị trí quyết định quyền: Giám đốc (mọi quyền) · Kế toán · Thủ quỹ (kiểm quỹ, chốt quỹ, xác nhận tiền chuyến) · Thủ kho · Bán hàng. Email Google dùng để đăng nhập bằng Google (có thể bỏ trống). Thêm nhân viên mới ở dòng dưới. Mật khẩu tạm do phần mềm tự cấp, hết hạn sau 72 giờ.", [{ h: "Họ tên", w: 28, required: true }, { h: "Tên đăng nhập", w: 18, required: true }, { h: "Email Google", w: 34 }, { h: "Vị trí", w: 18, required: true, list: roles }], userRows, 20), [1, 2, 3, 4], 3, 2 + userRows.length);

  // ── Mẫu in
  const docs: Row[] = [["M1", "Hóa đơn bán hàng", "SALE_INVOICE"], ["M2", "Báo giá", "QUOTE"], ["M3", "Phiếu giao hàng", "DELIVERY_NOTE"], ["M3b", "Phiếu chuyến giao", "TRIP_SHEET"], ["M4", "Phiếu thu", "RECEIPT"], ["M5", "Phiếu chi", "PAYMENT"], ["M6", "Lệnh sản xuất", "PRODUCTION_ORDER"], ["M7", "Bảng đối chiếu công nợ", "DEBT_STATEMENT"], ["M8", "Phiếu nhập hàng", "PURCHASE_RECEIPT"], ["M9", "Phiếu kiểm kho", "STOCKTAKE"]];
  table(wb, "Mẫu in", "Mỗi loại phiếu in qua 1 file Google Doc mẫu. Dán đường link file mẫu (đã chia sẻ cho tài khoản Google của xưởng) hoặc ghi “dùng mẫu chuẩn của phần mềm”. Gửi kèm file ảnh logo và QR (nếu có) — không dán vào bảng.", [{ h: "Mã mẫu", w: 10 }, { h: "Loại phiếu", w: 28 }, { h: "Mã kỹ thuật", w: 22 }, { h: "Link Google Doc mẫu / ghi chú", w: 60, required: true }], docs, 5);

  await wb.xlsx.writeFile(outPath!);
  console.log(`Đã tạo ${outPath}: ${prodCount} sản phẩm, ${customers.length} khách, ${suppliers.length} NCC, ${bomRows.length} cặp định mức, ${gc.length} kiểu gia công.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
