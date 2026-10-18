# Giá vốn tham khảo tôn gia công — 19/10/2026

Đã triển khai cấu hình tại **Sản phẩm → Gia công → Giá vốn tham khảo theo khổ gia công**.

## Cách dùng

1. Gắn kiểu gia công cho sản phẩm và khai báo tỷ lệ m²/m dài đúng với khổ thành phẩm. Đơn vị gốc sản phẩm cần là mét dài (`m`, `md`...).
2. Chọn kiểu và ngày hiệu lực cho phiên bản dự toán mới. Cấu hình không được lùi ngày; mỗi phạm vi có một phiên bản cho một ngày hiệu lực.
3. Chọn mã tôn đầu vào, để hệ thống nhận diện nếu tôn đã nằm trong BOM và tránh tính hai lần.
4. Chọn giá tôn kế hoạch cố định (đ/m² theo khổ đã gia công), hoặc giá nhập nguyên liệu gần nhất tại thời điểm đơn. Với giá nhập và BOM chưa có tôn, khai báo lượng tôn trên 1 mét dài theo ĐVT gốc nguyên liệu; nếu BOM có tôn thì dùng lượng BOM.
5. Nhập phí gia công gộp theo mét dài. Để trống phí riêng = kế thừa mức mặc định kiểu. Nhập `0` = xác nhận không tính phí. Phí mặc định của kiểu tác động đến mọi sản phẩm chưa có mức riêng và cần quyền quản lý danh mục.

Không tự đặt giá 44.322 hoặc phí 2.000 cho dữ liệu thật: đây là ví dụ, cần nhập đúng giá đã được doanh nghiệp chốt.

## Công thức và hiển thị

Với r m²/m dài: giá tôn cố định đ/m² × r + vật liệu phụ BOM đ/m dài + phí gia công đ/m dài = tổng dự toán đ/m dài. Giao diện chia tổng cho r khi hiển thị theo m². Giá tôn đã theo khổ thành phẩm nên không quy đổi thêm một lần nữa.

Nếu chọn giá nhập nguyên liệu: đơn giá nhập theo ĐVT gốc × lượng tôn/1 mét dài. Khi mã tôn đã có trong BOM, loại phần giá tôn cũ khỏi tổng BOM trước khi cộng giá tôn đã chọn. Không thay đổi định mức xuất vật tư.

Thiếu tỷ lệ cho giá cố định, thiếu giá nguyên liệu hoặc chưa khai báo phí thì báo chưa đủ dữ liệu, không mặc định bằng 0. Nếu tôn chưa có trong BOM xuất kho, cảnh báo riêng luôn hiển thị cả trên dòng gọn.

Màn bán hàng và chi tiết đơn hiển thị tổng cùng các thành phần tôn, vật liệu phụ, phí gia công, nguồn giá và ngày hiệu lực. Giá vốn FIFO/lãi thực tế vẫn theo luồng hiện hành.

## Lịch sử, quyền và dữ liệu

- Bảng mới `reference_cost_plans`: phiên bản riêng sản phẩm × kiểu và phiên bản phí mặc định kiểu. Phiên bản cũ không bị sửa đè.
- `sale_order_lines.referenceCostSnapshot` lưu dự toán từ server trong giao dịch lưu đơn. Mở lại đơn/sửa dòng không đổi sản phẩm, kiểu và chế độ xuất thì giữ dự toán cũ; xác nhận đơn nháp chụp lại theo ngày xác nhận. Không lấy giá dự toán từ payload client.
- Chỉ trả dự toán đơn cho người có `order.analysis.view`, `cost.view`, `purchase_price.view`. Cấu hình cần `product.view`, `cost.view`, `purchase_price.view`; ghi mức riêng cần `product.manage` hoặc `bom.manage`; ghi phí mặc định cần `catalog.manage`.
- Nhật ký lưu người lập cấu hình, dữ liệu và thời điểm; giá/phí được che theo quyền.
- Đơn cũ không được backfill dự toán hoặc tự điều chỉnh xuất kho. Trường mới có thể trống.

Triển khai phải chạy migration `20261018180000_reference_cost_plans` và sinh Prisma Client trước khi chạy ứng dụng mới. `db/db_schema.sql` đã được cập nhật từ các migration.
