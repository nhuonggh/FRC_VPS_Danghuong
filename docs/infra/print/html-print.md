# In trực tiếp bằng HTML

Áp dụng cho mọi loại phiếu: `SALE_INVOICE`, `QUOTE`, `DELIVERY_NOTE`, `RECEIPT`, `PAYMENT`, `PRODUCTION_ORDER`, `DEBT_STATEMENT`, `PURCHASE_RECEIPT`, `STOCKTAKE`, `GOODS_RETURN`, `TRIP_SHEET`, `LOSS_ADJUST`, `DISCOUNT_SETTLEMENT`, `SUPPLIER_ORDER`. Ba mẫu gốc (hóa đơn, giao nhận, nhập hàng) bám 6 file HTML của người dùng; các phiếu còn lại dùng chung CSS/khung của hóa đơn (cùng phong cách, chỉ đổi bảng, khối thông tin, tổng và chữ ký) — xem `renderHtmlPrint` trong `src/server/print/html-document.ts`. Các nút In mở `/api/print/<loại>/<id>/html?auto=1`. Trang độc lập tự mở hộp thoại in sau khi font và ảnh tải xong; có nút in lại và đổi màu/đen trắng. Dùng A4, tỷ lệ 100%, tắt header/footer của trình duyệt. Có thể chọn máy in hoặc Lưu PDF.

Không cần webhook, secret hoặc Google Docs. Không ghi `print_files` khi xem/in HTML; mỗi lần mở đọc dữ liệu hiện tại.

## Mẫu và cấu hình

- CSS lấy từ 6 file HTML người dùng cung cấp trong thư mục `phiếu in/3phieu`, lưu tại `src/server/print/html-styles.json`.
- Thông tin công ty, logo, ngân hàng lấy từ cấu hình Công ty; không giữ số liệu, logo hoặc tên người ký minh họa.
- Người ký, QR và chân phiếu lấy từ mẫu đang bật của đúng loại chứng từ, ID nhỏ nhất. Không có mẫu cấu hình vẫn in được, các thông tin tùy chọn để trống.
- Font Be Vietnam Pro được đóng gói ở `public/fonts/print`, từ font đã dùng trong bản build ứng dụng. Không phụ thuộc Google Fonts khi in.
- Endpoint kiểm tra phiên, quyền in, quyền loại phiếu và phạm vi đối tác; phiếu hủy/đơn nháp không in được. Phản hồi không cache, không chứa giá vốn/lãi hay secret.

## Quy tắc dữ liệu

- Hóa đơn: gộp các dòng kích thước liền nhau cùng sản phẩm, gia công, giá và ghi chú; tổng tiền cộng từ thành tiền nghiệp vụ, không nhân lại giá m² đã làm tròn. Nợ cũ cùng định nghĩa với danh sách đơn: đầu kỳ + phát sinh trước thời điểm lập đơn. Chỉ hiển thị khi có `debt.view`. Đã thu là tiền gắn với đơn theo `orderPaid`. Số tiền bằng chữ tương ứng số còn phải trả.
- Giao nhận: theo từng phiếu giao, không in giá. Giao đủ một dòng có quy cách thì hiện số tấm. Giao một phần chưa lưu phân bổ số tấm theo chiều dài nên chỉ hiện lượng thực giao theo đơn vị lưu; không in toàn bộ quy cách gốc như đã giao đủ.
- Nhập hàng: tổng tiền hàng theo `purchaseTotal`, cước theo dõi riêng. DB chưa có khối lượng tách riêng hoặc thanh toán gắn từng phiếu nhập; các trường này để trống/—, không gán toàn bộ phiếu chi NCC vào một phiếu nhập. Tiền bằng chữ là tổng tiền hàng. Nợ cũ NCC đảo dấu sổ công nợ chung để dương là số phải trả NCC.

## Kiểm tra không tác động DB

`npx vitest run --config vitest.print.config.mts`

Cấu hình này không chạy global setup xóa schema/migrate của bộ integration test. Bao gồm kiểm tra quyền, dữ liệu tài chính, giao một phần, gộp quy cách, XSS, route không cache và nút in/lập đơn.
