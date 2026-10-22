# In chứng từ (plan 05 · D6) — luồng Google Apps Script đã NGỪNG DÙNG

> **Từ 22/10/2026 mọi phiếu (M1–M10 + phiếu chuyến) in trực tiếp bằng [mẫu HTML](./html-print.md); giao diện không còn gọi Apps Script.** Phần dưới chỉ giữ để tham khảo/dọn dẹp: `POST /api/print/:docType/:docId`, `service.ts`, `webhook.ts` và `apps-script.gs` chưa bị xóa.

Hệ thống **không tự dựng file in**: mỗi lần bấm **In**, server gửi dữ liệu chứng từ (JSON) tới một Google Apps Script của xưởng;
script sao chép **Google Doc mẫu**, điền `<<placeholder>>`, lưu vào thư mục Drive và trả link. Mở link → in hoặc tải PDF.

- Chỉ gọi tới `https://script.google.com/…` (chống gửi dữ liệu ra địa chỉ lạ). Quá **12 giây** không phản hồi → báo lỗi, không treo màn hình.
- **Secret** nằm trong nội dung gửi đi (không trong URL), lưu mã hoá trong hệ thống, không hiện lại, không ghi log/nhật ký.
- Mỗi chứng từ giữ **một** bản in: in lại → bản cũ vào thùng rác Drive.
- Không có phương án in dự phòng: nếu Google lỗi thì chờ hoặc thử lại (đã chấp nhận ở spec 5.5).

## 1. Tạo Google Doc mẫu (mỗi loại chứng từ một Doc)

Soạn giao diện tuỳ ý (logo, khung, chữ ký). Chèn `<<tên>>` vào chỗ cần điền. Bảng dòng hàng: tạo bảng, đặt các `<<lines.xxx>>` trong **một hàng mẫu**;
hệ thống nhân bản hàng đó cho từng dòng hàng.

| Nhóm | Placeholder |
|---|---|
| Chung | `<<docCode>>` `<<template.title>>` `<<template.signerName>>` `<<template.phone>>` `<<template.qrImage>>` `<<template.footerNote>>` |
| Công ty (khi mẫu bật “hiện thông tin công ty”) | `<<company.name>>` `<<company.address>>` `<<company.phone>>` `<<company.taxCode>>` `<<company.logo>>` `<<company.bank.bankName>>` `<<company.bank.accountNo>>` `<<company.bank.accountHolder>>` `<<company.bank.branch>>` |
| Đối tác | `<<partner.code>>` `<<partner.name>>` `<<partner.phone>>` `<<partner.address>>` |
| Chứng từ | `<<doc.code>>` `<<doc.date>>` `<<doc.note>>` … (xem bảng theo loại bên dưới) |
| Dòng hàng | `<<lines.no>>` `<<lines.code>>` `<<lines.name>>` `<<lines.unit>>` `<<lines.qty>>` … (theo loại) |
| Tổng | `<<totals.total>>` … (theo loại) |

Số tiền/số lượng/ngày đã định dạng kiểu Việt Nam (chuỗi), điền thẳng vào Doc.

| Mã mẫu | Loại (`docType` khi cấu hình) | doc.* | lines.* | totals.* |
|---|---|---|---|---|
| M1 Hóa đơn bán hàng | `SALE_INVOICE` | code, date, expectedDelivery, note, createdBy, status | no, code, name, unit, qty, price, discountNow, discountAccum, amount, processing | discountNow, discountAccum, total, paid, remaining |
| M2 Báo giá | `QUOTE` | code, date, note, status, createdBy | no, code, name, unit, qty, price, amount, note | total |
| M3 Phiếu giao nhận | `DELIVERY_NOTE` (mỗi phiếu giao) | code, orderCode, date, note, status | no, code, name, unit, qty | totalQty |
| M3b Phiếu giao nhận theo chuyến | `TRIP_SHEET` | code, date, vehicle, driver, assistant, route, note, status | stop, order, customer, phone, address, no, code, name, unit, qty, due | stops |
| M4 Phiếu thu | `RECEIPT` | code, type, date, account, order, note, createdBy, status | — | amount |
| M5 Phiếu chi | `PAYMENT` | code, type, date, account, order, note, createdBy, status | — | amount |
| M6 Lệnh sản xuất | `PRODUCTION_ORDER` | code, date, note, createdBy, status | section, no, code, name, spec, unit, qty | — |
| M7 Đối chiếu công nợ | `DEBT_STATEMENT` (theo khách) | code, date, note | no, date, docLabel, docCode, debit, credit, running | opening, debit, credit, balance, discountBalance |
| M8 Phiếu nhập hàng | `PURCHASE_RECEIPT` | code, date, note, createdBy, status | no, code, name, unit, qty, price, amount, rollInfo | freight, total |
| M9 Phiếu kiểm kho | `STOCKTAKE` | code, date, note, createdBy, statusLabel, status | no, code, name, unit, systemQty, actualQty, diff | — |
| M11 Phiếu hao hụt / xuất hủy | `LOSS_ADJUST` | code, kind, date, note, createdBy, status | no, code, name, unit, qty | — |
| M12 Phiếu tất toán chiết khấu | `DISCOUNT_SETTLEMENT` | code, date, method, payment, note, createdBy, status | — | amount |
| M13 Đơn đặt hàng NCC | `SUPPLIER_ORDER` | code, date, note, createdBy, status | no, code, name, unit, qty, price, amount, processing, note | total |
| M10 Phiếu trả hàng | `GOODS_RETURN` | code, kind, date, orderCode, note, createdBy, status | no, code, name, unit, qty, price, amount, note | total, deduction, deductionNote, net |

Hóa đơn có **chiết khấu theo dòng** (`lines.discountNow`, `lines.discountAccum`) và **tổng chiết khấu** (`totals.discountNow`, `totals.discountAccum`), **đã thu** (`totals.paid` = cọc + thu nợ theo đơn + tiền lái xe đã thu), **còn phải trả** (`totals.remaining`). Bản in **không có giá vốn/lãi**.

## 2. Tạo Apps Script

1. Vào <https://script.google.com> → **Dự án mới**, đặt tên `DHERP In chứng từ`.
2. Xoá nội dung mặc định, dán toàn bộ file [`apps-script.gs`](./apps-script.gs).
3. **Project Settings → Script properties → Add**:
   - `SECRET` = chuỗi ngẫu nhiên dài (≥ 8 ký tự, khuyến nghị 24+). **Ghi lại để nhập vào hệ thống.**
   - `TEMPLATES` = `{"SALE_INVOICE":"<id Doc M1>","QUOTE":"<id Doc M2>","DELIVERY_NOTE":"<id>","RECEIPT":"<id>","PAYMENT":"<id>","DEBT_STATEMENT":"<id>","PURCHASE_RECEIPT":"<id>","TRIP_SHEET":"<id>"}` (id là đoạn dài trong URL của Doc: `docs.google.com/document/d/<ID>/edit`).
   - `FOLDER_ID` = id thư mục Drive chứa bản in (tạo thư mục riêng, chia sẻ cho nhân viên cần xem).
   - `SHARING` = `PRIVATE` (mặc định) hoặc `LINK`.
4. **Triển khai (Deploy) → Triển khai mới → Loại: Ứng dụng web**: *Thực thi bằng* **Tôi**; *Ai có quyền truy cập* **Bất kỳ ai**. Cấp quyền Drive/Docs khi Google hỏi. Sao chép **URL ứng dụng web** (kết thúc bằng `/exec`).
   - Mỗi lần sửa script phải **Quản lý triển khai → Chỉnh sửa → Phiên bản mới** thì bản chạy thật mới đổi.
   - “Bất kỳ ai” là bắt buộc để server gọi được; **bảo vệ bằng `SECRET`** (script từ chối mọi lệnh sai secret).

## 3. Khai báo trong hệ thống

Đăng nhập tài khoản có quyền *company.manage* → **Hệ thống → Công ty & mẫu in → Mẫu in → Thêm**:
- Loại chứng từ: đúng mã ở bảng trên (vd `SALE_INVOICE`), Tên: tuỳ ý.
- Địa chỉ webhook: URL `/exec` ở bước 2.4. Secret: đúng `SECRET`. Tiêu đề / người ký / SĐT / ghi chú chân phiếu: tuỳ ý. **Bật** mẫu.

## 4. Thử

Mở một đơn hàng → **In hóa đơn** (cần quyền *In chứng từ* + *Xem giá bán*). Vài giây sau hiện link **Mở bản in**. In lại sẽ thay bản cũ.

## Lỗi thường gặp

| Thông báo | Nguyên nhân |
|---|---|
| Chưa bật mẫu in cho … | Chưa thêm/bật mẫu đúng `docType` |
| Webhook … phải là địa chỉ Google Apps Script | URL không phải `https://script.google.com/…` |
| Apps Script trả về nội dung không phải JSON | Chưa triển khai “Ứng dụng web”, quyền không phải “Bất kỳ ai”, hoặc URL cũ (chưa tạo phiên bản mới) |
| Apps Script báo lỗi: unauthorized | `SECRET` ở script khác secret trong hệ thống (nhập lại secret ở màn Mẫu in) |
| … chưa khai báo mẫu Google Doc cho … | Thiếu khoá tương ứng trong `TEMPLATES` |
| Google Apps Script không phản hồi trong 12 giây | Google chậm/lỗi — thử lại; kiểm tra script có chạy quá lâu không |
| Không giải mã được secret | Đổi `AUTH_SECRET`/`PRINT_TEMPLATE_KEY` trên VPS → nhập lại secret của mẫu |
