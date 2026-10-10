/**
 * DHERP — tạo Google Sheet "Bảng nhập dữ liệu đầu vào" để gửi khách điền.
 * Cách dùng: script.google.com → Dự án mới → dán file này → chạy hàm createIntakeWorkbook() (cấp quyền) → xem link ở Logs / hộp thoại.
 * Tiêu đề cột các trang khách hàng/NCC/sản phẩm/số đầu kỳ KHỚP CHÍNH XÁC bộ nhập Excel của hệ thống (đừng đổi tên cột, đừng đổi thứ tự sheet
 * tiêu đề dòng 1). Dòng 2 màu xám bắt đầu bằng "#" là ví dụ — hệ thống tự bỏ qua dòng này khi nhập.
 * Sau khi khách điền: File → Tải xuống → từng sheet cần nhập → Excel (.xlsx) (hoặc tải cả sổ rồi tách sheet) và nhập ở
 * Hệ thống → Chuyển dữ liệu. Các sheet danh mục (nhóm, kho, xe…) nhập tay ở Cài đặt danh mục.
 */
var HEADER_BG = '#1f3a5f', HEADER_FG = '#ffffff', SAMPLE_BG = '#eeeeee', REQUIRED_BG = '#b3261e';

// name: tên sheet; cols: [{h: tiêu đề, s: ví dụ, r: bắt buộc, w: độ rộng, list: [giá trị dropdown] | listRef: 'Sheet!A2:A'}]
function sheets_() {
  var yn = ['Có', 'Không'];
  return [
    { name: 'Nhóm khách hàng', note: 'Liệt kê các nhóm khách (vd: Khách lẻ, Đại lý, Thầu). Trang Khách hàng/NCC sẽ chọn từ danh sách này.', help: 'Nhập ở Hệ thống → Cài đặt danh mục → Nhóm khách hàng.', cols: [{ h: 'Tên nhóm', s: 'Khách lẻ', r: 1, w: 220 }] },
    { name: 'Nhóm hàng', help: 'Nhóm sản phẩm (vd: Tôn, Hộp mạ kẽm, Inox). Cài đặt danh mục → Nhóm hàng; cột Nhóm hàng ở sheet Sản phẩm chọn từ danh sách này.', cols: [{ h: 'Tên nhóm hàng', s: 'Tôn', r: 1, w: 220 }] },
    { name: 'Kho', help: 'Cài đặt danh mục → Kho.', cols: [{ h: 'Tên kho', s: 'Kho chính', r: 1, w: 220 }] },
    { name: 'Xe', help: 'Cài đặt danh mục → Xe.', cols: [{ h: 'Biển số', s: '51C-123.45', r: 1, w: 180 }] },
    { name: 'Lái xe & phụ xe', help: 'Cài đặt danh mục → Lái xe & phụ xe.', cols: [{ h: 'Họ tên', s: 'Nguyễn Văn A', r: 1, w: 220 }, { h: 'Là phụ xe', s: 'Không', w: 110, list: yn }] },
    { name: 'Tuyến giao hàng', help: 'Cài đặt danh mục → Tuyến giao hàng.', cols: [{ h: 'Tên tuyến', s: 'Quận 12', r: 1, w: 220 }] },
    { name: 'Loại thu chi', help: 'Loại chi phí: lương, dầu, điện, sửa xe… Cài đặt danh mục → Loại thu chi.', cols: [{ h: 'Tên loại', s: 'Tiền điện', r: 1, w: 220 }] },
    { name: 'Ngân hàng & quỹ', help: 'Quỹ tiền mặt và từng tài khoản ngân hàng. Cài đặt danh mục → Ngân hàng & quỹ.', cols: [{ h: 'Tên tài khoản', s: 'Tiền mặt', r: 1, w: 220 }, { h: 'Loại', s: 'Tiền mặt', r: 1, w: 120, list: ['Tiền mặt', 'Ngân hàng'] }, { h: 'Số tài khoản', s: '0123456789', w: 180 }] },
    { name: 'Kiểu gia công', help: 'Tôn xốp, 1 lớp, 6 sóng, 11 sóng… Cài đặt danh mục → Kiểu gia công.', cols: [{ h: 'Tên kiểu gia công', s: 'Tôn xốp', r: 1, w: 220 }, { h: 'Ghi chú', s: '', w: 260 }, { h: 'Tỷ lệ', s: '1,08', w: 90 }, { h: 'Tỷ lệ trừ kho', s: '1', w: 110 }, { h: 'ĐVT', s: 'm2', w: 80 }] },
    { name: 'Công ty', help: 'Hệ thống → Công ty & mẫu in. Logo/QR: gửi kèm file ảnh, không dán vào bảng.', cols: [{ h: 'Thông tin', s: '', w: 260 }, { h: 'Giá trị', s: '', w: 420 }], rows: [['Tên công ty', ''], ['Địa chỉ', ''], ['Điện thoại', ''], ['Mã số thuế', ''], ['Ngân hàng', ''], ['Số tài khoản', ''], ['Chủ tài khoản', ''], ['Chi nhánh', ''], ['Người ký (in trên phiếu)', ''], ['Ghi chú chân phiếu', '']], noSample: true },
    { name: 'Người dùng', help: 'Hệ thống → Người dùng. Hệ thống tự cấp mật khẩu tạm; email dùng để đăng nhập bằng Google.', cols: [{ h: 'Họ tên', s: 'Nguyễn Thị B', r: 1, w: 220 }, { h: 'Tên đăng nhập', s: 'ketoan1', r: 1, w: 160 }, { h: 'Email Google', s: 'ketoan1@gmail.com', w: 240 }, { h: 'Vị trí', s: 'Kế toán', r: 1, w: 140, list: ['Giám đốc', 'Kế toán', 'Thủ kho', 'Thủ quỹ', 'Bán hàng'] }] },
    { name: 'Khách hàng', imp: 'Nhập bằng Excel: Bán hàng → Khách hàng → Nhập từ Excel.', cols: partnerCols_(yn) },
    { name: 'Nhà cung cấp', imp: 'Nhập bằng Excel: Nhập hàng → Nhà cung cấp → Nhập từ Excel.', cols: partnerCols_(yn) },
    { name: 'Sản phẩm', imp: 'Nhập bằng Excel: Kho → Sản phẩm → Nhập từ Excel. Mã ngừng bán/trùng sẽ ra tệp riêng để xác nhận.', cols: [
      { h: 'Nhóm hàng', s: 'Tôn', w: 150, listRef: "'Nhóm hàng'!A2:A" },
      { h: 'Kiểu gia công', s: 'Tôn xốp,11 sóng', w: 200 },
      { h: 'Mã', s: 'SP001', r: 1, w: 110 }, { h: 'Tên', s: 'Tôn lạnh', r: 1, w: 260 },
      { h: 'Loại', s: 'Hàng hóa', w: 150, list: ['Hàng hóa', 'Nguyên vật liệu', 'Thành phẩm', 'Phụ kiện'] },
      { h: 'Đơn vị gốc', s: 'md', r: 1, w: 100 }, { h: 'Định mức tồn', s: '0', w: 110 }, { h: 'Đơn vị quy đổi', s: 'kg', w: 120 }, { h: 'Tỷ trọng', s: '2,4', w: 120 },
      { h: 'Tôn cuộn', s: 'Không', w: 90, list: yn }, { h: 'Ngừng bán', s: 'Không', w: 100, list: yn }, { h: 'Ghi chú', s: '', w: 240 }] },
    { name: 'Định mức (BOM)', help: 'Nhập tay ở Sản xuất → Định mức (chưa có nhập Excel). Mỗi dòng = 1 nguyên vật liệu của 1 thành phẩm theo kiểu gia công, kèm ngày bắt đầu hiệu lực.', cols: [
      { h: 'Mã thành phẩm', s: 'TX01', r: 1, w: 130 }, { h: 'Kiểu gia công', s: 'Tôn xốp', r: 1, w: 150, listRef: "'Kiểu gia công'!A2:A" }, { h: 'Ngày hiệu lực (dd/mm/yyyy)', s: '01/10/2026', r: 1, w: 170 },
      { h: 'Mã nguyên vật liệu', s: 'NVL01', r: 1, w: 150 }, { h: 'Định mức / 1 đơn vị thành phẩm', s: '0,45', r: 1, w: 200 }, { h: 'Ghi chú (mùa, độ dày…)', s: '', w: 220 }] },
    { name: 'Tồn kho đầu kỳ', imp: 'Nhập bằng Excel: Kỳ & số đầu kỳ → Tồn kho đầu kỳ. Chỉ hàng hóa/thành phẩm/phụ kiện; mỗi mã một dòng.', cols: [{ h: 'Mã', s: 'SP001', r: 1, w: 120 }, { h: 'Số lượng', s: '1.250,5', r: 1, w: 130 }, { h: 'Giá vốn / đơn vị gốc', s: '18.500', r: 1, w: 180 }] },
    { name: 'Tồn NVL đầu kỳ', imp: 'Nhập bằng Excel: Kỳ & số đầu kỳ → Tồn NVL đầu kỳ. Chỉ nguyên vật liệu.', cols: [{ h: 'Mã', s: 'NVL01', r: 1, w: 120 }, { h: 'Số lượng', s: '3.200', r: 1, w: 130 }, { h: 'Giá vốn / đơn vị gốc', s: '21.000', r: 1, w: 180 }] },
    { name: 'Công nợ đầu kỳ', imp: 'Nhập bằng Excel: Kỳ & số đầu kỳ → Công nợ đầu kỳ. Khách nợ mình: số DƯƠNG. Mình nợ NCC: số ÂM.', cols: [{ h: 'Mã đối tác', s: 'KH001', r: 1, w: 140 }, { h: 'Số dư (+ khách nợ, − mình nợ)', s: '12.500.000', r: 1, w: 230 }] },
    { name: 'Số dư quỹ đầu kỳ', imp: 'Nhập bằng Excel: Kỳ & số đầu kỳ → Số dư quỹ đầu kỳ. Tên phải khớp sheet "Ngân hàng & quỹ".', cols: [{ h: 'Tên quỹ / tài khoản', s: 'Tiền mặt', r: 1, w: 240, listRef: "'Ngân hàng & quỹ'!A2:A" }, { h: 'Số dư', s: '50.000.000', r: 1, w: 160 }] },
    { name: 'Chiết khấu tích lũy', imp: 'Nhập bằng Excel: Kỳ & số đầu kỳ → Chiết khấu tích lũy đầu kỳ. Số tiền xưởng CÒN NỢ khách (không âm).', cols: [{ h: 'Mã khách hàng', s: 'KH001', r: 1, w: 140 }, { h: 'Chiết khấu còn nợ khách', s: '1.200.000', r: 1, w: 220 }] }
  ];
}
function partnerCols_(yn) {
  return [{ h: 'Mã', s: 'KH001', r: 1, w: 110 }, { h: 'Tên', s: 'Nguyễn Văn Đạt', r: 1, w: 240 }, { h: 'Nhóm', s: 'Khách lẻ', r: 1, w: 150, listRef: "'Nhóm khách hàng'!A2:A" },
    { h: 'Điện thoại', s: '0912345678', w: 130 }, { h: 'Địa chỉ', s: 'Quận 12, TP.HCM', w: 280 }, { h: 'Hạn mức nợ', s: '12.500.000', w: 130 },
    { h: 'Cho ghi nợ', s: 'Có', w: 100, list: yn }, { h: 'Người phụ trách', s: 'nam', w: 140 }, { h: 'Ghi chú', s: '', w: 220 }];
}

function createIntakeWorkbook() {
  var ss = SpreadsheetApp.create('DHERP – Bảng nhập dữ liệu đầu vào');
  var first = ss.getSheets()[0];
  writeGuide_(first);
  sheets_().forEach(function (def) { buildSheet_(ss, def); });
  ss.setActiveSheet(first);
  var url = ss.getUrl();
  Logger.log('Đã tạo: ' + url);
  try { SpreadsheetApp.getUi().alert('Đã tạo bảng nhập liệu:\n' + url); } catch (e) { /* chạy ngoài giao diện */ }
  return url;
}

function writeGuide_(sh) {
  sh.setName('HƯỚNG DẪN');
  var lines = [
    ['BẢNG NHẬP DỮ LIỆU ĐẦU VÀO — XƯỞNG TÔN ĐẶNG HƯƠNG'],
    [''],
    ['Ngày chốt số đầu kỳ (dd/mm/yyyy):', ''],
    ['Người điền / liên hệ:', ''],
    [''],
    ['CÁCH ĐIỀN'],
    ['1. Điền theo thứ tự các trang (tab) từ trái sang phải. Ô tiêu đề đỏ = bắt buộc.'],
    ['2. KHÔNG đổi tên trang, KHÔNG đổi tên/thứ tự cột dòng 1, KHÔNG chèn cột. Dòng 2 màu xám là ví dụ (bắt đầu bằng #) — có thể xoá hoặc để nguyên.'],
    ['3. Số tiền: nhập kiểu Việt Nam (12.500.000 hoặc 1.234,5). Ô có mũi tên ▾ chọn từ danh sách.'],
    ['4. Mã khách/NCC/sản phẩm: chữ không dấu, số, dấu . _ - ; mỗi mã chỉ một dòng, không trùng.'],
    ['5. Số đầu kỳ (tồn kho, NVL, công nợ, quỹ, chiết khấu) phải là số tại CÙNG MỘT ngày chốt ghi ở trên.'],
    ['6. Đơn vị gốc của sản phẩm thường là md (mét dài); tồn kho và giá vốn luôn tính theo đơn vị gốc.'],
    [''],
    ['THỨ TỰ CÁC TRANG'],
    ['A. Danh mục nền: Nhóm khách hàng → Kho → Xe → Lái xe & phụ xe → Tuyến giao hàng → Loại thu chi → Ngân hàng & quỹ → Kiểu gia công → Công ty → Người dùng'],
    ['B. Dữ liệu chính: Khách hàng → Nhà cung cấp → Sản phẩm → Định mức (BOM)'],
    ['C. Số đầu kỳ (tại ngày chốt): Tồn kho → Tồn NVL → Công nợ → Số dư quỹ → Chiết khấu tích lũy'],
    [''],
    ['Đã điền xong thì gửi lại đường link/ file này. Việc nhập vào hệ thống do bên phần mềm thực hiện (có bước xem trước, khách xác nhận trước khi ghi).']
  ];
  var width = 2;
  var range = sh.getRange(1, 1, lines.length, width);
  range.setValues(lines.map(function (l) { return [l[0], l[1] || '']; }));
  sh.getRange(1, 1).setFontSize(16).setFontWeight('bold');
  [6, 14].forEach(function (r) { sh.getRange(r, 1).setFontWeight('bold'); });
  sh.getRange(3, 1, 2, 1).setFontWeight('bold');
  sh.getRange(3, 2, 2, 1).setBackground('#fff8dc').setBorder(true, true, true, true, false, false);
  sh.setColumnWidth(1, 900); sh.setColumnWidth(2, 260);
  sh.getRange(1, 1, lines.length, 1).setWrap(true);
}

function buildSheet_(ss, def) {
  var sh = ss.insertSheet(def.name);
  var cols = def.cols, n = cols.length;
  var head = sh.getRange(1, 1, 1, n);
  head.setValues([cols.map(function (c) { return c.h; })]).setFontColor(HEADER_FG).setFontWeight('bold').setWrap(true).setVerticalAlignment('middle');
  cols.forEach(function (c, i) {
    sh.getRange(1, i + 1).setBackground(c.r ? REQUIRED_BG : HEADER_BG);
    sh.setColumnWidth(i + 1, c.w || 150);
  });
  sh.setRowHeight(1, 40);
  var dataStart = 2;
  if (def.rows) { // trang dạng bảng thông tin cố định (Công ty)
    sh.getRange(2, 1, def.rows.length, 2).setValues(def.rows);
    sh.getRange(2, 1, def.rows.length, 1).setBackground(SAMPLE_BG).setFontWeight('bold');
    sh.getRange(2, 2, def.rows.length, 1).setBackground('#fff8dc');
    dataStart = 2 + def.rows.length;
  } else {
    sh.getRange(2, 1, 1, n).setValues([cols.map(function (c, i) { return i === 0 ? '# ' + c.s + ' (ví dụ — dòng này không được nhập)' : c.s; })]).setBackground(SAMPLE_BG).setFontColor('#666666').setFontStyle('italic');
    dataStart = 3;
  }
  // định dạng văn bản cho cột mã/số điện thoại (giữ số 0 đầu) và dropdown
  var maxRows = 2000;
  cols.forEach(function (c, i) {
    var body = sh.getRange(dataStart, i + 1, maxRows, 1);
    if (/^(Mã|Điện thoại|Số tài khoản|Mã đối tác|Mã khách hàng|Biển số)/.test(c.h)) body.setNumberFormat('@');
    var rule = null;
    if (c.list) rule = SpreadsheetApp.newDataValidation().requireValueInList(c.list, true).setAllowInvalid(false).build();
    else if (c.listRef) rule = SpreadsheetApp.newDataValidation().requireValueInRange(ss.getRange(c.listRef.indexOf('!') > 0 ? c.listRef : def.name + '!' + c.listRef), true).setAllowInvalid(true).build();
    if (rule) body.setDataValidation(rule);
  });
  sh.setFrozenRows(1);
  var help = def.imp || def.help;
  if (help) sh.getRange(1, 1).setNote(help);
  // ô ghi chú hướng dẫn ngay trên cùng bên phải bảng
  sh.getRange(1, n + 2).setValue(help || '').setWrap(true).setFontStyle('italic').setFontColor('#555555');
  sh.setColumnWidth(n + 2, 360);
  return sh;
}
