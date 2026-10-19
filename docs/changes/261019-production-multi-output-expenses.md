# Lệnh sản xuất nhiều đầu ra và form chi phí hoạt động

Một lệnh xuất các nguyên liệu theo FIFO và nhập nhiều sản phẩm đầu ra trong cùng giao dịch, dùng chung khóa idempotency. Đầu ra phụ nhập về mã sản phẩm có sẵn nếu cùng quy cách. Danh sách, chi tiết, báo cáo và dashboard đọc đầy đủ các đầu ra. Hủy lệnh gỡ tất cả đầu ra, hoàn nguyên liệu; chặn hủy nếu bất kỳ đầu ra nào đã được tiêu thụ.

Hai cách phân bổ:

- **Theo trọng số:** nhập số lượng theo đơn vị gốc và trọng số cho từng sản phẩm. Trọng số có thể là diện tích hoặc khối lượng đã xác định. Nhiều đầu ra bắt buộc có trọng số rõ ràng, không tự chia theo mét dài.
- **Xẻ khổ — theo diện tích:** một nguyên liệu mỗi lệnh, cùng vật liệu và độ dày, đơn vị gốc mét dài (`m`, `md`, `mét`, `mét dài`, `m dài`). Nhập khổ nguyên liệu (mm), khổ từng đầu ra, số dải và chiều dài mỗi dải. Số lượng nhập = số dải × chiều dài. Chiều dài mỗi dải bằng chiều dài nguyên liệu. Tổng khổ các dải không được vượt khổ đầu vào. Phần chưa ghi nhận thành đầu ra hiển thị là khổ còn lại/hao hụt và chi phí được phân bổ vào các đầu ra thực nhập; phần dùng được phải thêm dòng thu hồi.

Ví dụ: 10 m × 1.200 mm → 10 m × 900 mm + 10 m × 300 mm; trọng số diện tích 9:3, tỷ lệ 75%:25%. Xẻ bốn dải 300 mm nhập 40 m khổ 300, không so tổng mét đầu ra với 10 m đầu vào.

`production_outputs` lưu sản phẩm, số lượng, khổ, số dải, chiều dài, trọng số và seq. Header giữ sản phẩm/số lượng đầu tiên để tương thích dữ liệu cũ; không dùng header để cộng sản lượng nhiều đầu ra. Migration thêm một dòng đầu ra cho mỗi lệnh cũ, giữ nguyên liên kết lớp FIFO và seq. API cũ một đầu ra tiếp tục được hỗ trợ.

`cost_layers.costRefShare` mặc định 1 nên các lớp cũ và nghiệp vụ trả hàng giữ nguyên cách tính. Giá đơn vị = tổng vốn nguồn × tỷ lệ / số lượng, làm tròn HALF_UP bốn số thập phân theo engine hiện có; tỷ lệ lưu 12 số thập phân, dòng cuối nhận tỷ lệ còn lại để tổng bằng 1. Nhập kho, replay và lan truyền đều dùng cùng công thức. Giá trị tiền hiển thị theo độ chính xác tiền tệ; sai số do làm tròn đơn giá vẫn theo quy tắc hiện có của engine.

Form lập/sửa chi phí hoạt động dùng `NewPage wide` như phiếu chi, combobox tìm kiếm loại chi phí, quỹ và người ứng tiền. Người ứng tiền tùy chọn, lưu qua `payments.advancedById`; sửa tải lại lựa chọn đã lưu, kiểm tra tài khoản hợp lệ và ghi audit. Không phát sinh bút toán công nợ bổ sung.

Triển khai: chạy migration `20261019120000_production_multi_output` trước khi chạy phiên bản mới. Không cần thêm cột người ứng tiền vì migration `20261018120000_payment_advanced_by` đã có.
