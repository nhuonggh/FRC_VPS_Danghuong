# Bảng nhập dữ liệu đầu vào gửi khách

1. Vào <https://script.google.com> → Dự án mới → dán `create-intake-workbook.gs` → chọn hàm **createIntakeWorkbook** → Chạy (cấp quyền).
2. Link Google Sheet hiện ở hộp thoại / Xem → Nhật ký. Chia sẻ link (quyền Người chỉnh sửa) cho khách; trang **HƯỚNG DẪN** giải thích cách điền.
3. Khách điền xong: tải từng trang cần nhập về Excel (.xlsx, một trang mỗi tệp) rồi nhập ở **Hệ thống → Chuyển dữ liệu** (xem trước → xác nhận). Trang danh mục nền/công ty/người dùng/định mức: nhập tay theo cột “Nhập ở…” ghi trong ô chú thích.
4. Đổi cột ở code (import Excel) thì phải sửa script — test `tests/print/intake-script.test.ts` sẽ báo lệch.

Trang có sẵn: HƯỚNG DẪN · 8 danh mục (nhóm KH, kho, xe, lái/phụ xe, tuyến, loại thu chi, ngân hàng & quỹ, kiểu gia công) · Công ty · Người dùng · Khách hàng · Nhà cung cấp · Sản phẩm · Định mức (BOM) · Tồn kho/NVL đầu kỳ · Công nợ · Số dư quỹ · Chiết khấu tích lũy.
