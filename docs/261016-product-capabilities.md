# 16/10/2026 — Sản phẩm có nhiều khả năng sử dụng

## Quy tắc

- Một sản phẩm giữ nguyên ID/mã, đơn vị gốc, tồn và các lớp giá vốn FIFO.
- `kind` phân loại; `canSell`, `canPurchase`, `canUseAsMaterial`, `canProduce` kiểm soát độc lập các mục đích sử dụng. Đổi loại không tự đổi các cờ đã lưu.
- BOM và lệnh sản xuất dùng chung khả năng đầu vào/đầu ra. Thành phẩm được làm đầu vào khi bật `canUseAsMaterial`; lệnh yêu cầu đủ tồn thực tế, không tự bung BOM nhiều cấp.
- Lệnh ghi xuất nguyên liệu trước, nhập đầu ra sau. Giá đầu ra lấy vốn FIFO của đầu vào; không lấy giá bán mặc định.
- Dòng bán có `issueMode`: `STOCK` xuất chính mã bán, `BOM` xuất nguyên liệu theo định mức, `LEGACY` tương thích cách chọn kiểu gia công trước đây. Dòng được lưu với cách xuất thực tế; đơn đã ghi sổ giữ phiên bản BOM khi sửa dòng không đổi mã/kiểu. Đổi cách xuất là sửa nghiệp vụ và đi qua giao dịch kho hiện có.
- Bộ chọn và server cùng kiểm tra khả năng; trạng thái ngừng sử dụng vẫn là điều kiện chung. Chứng từ lịch sử vẫn đọc được. Việc giữ sản phẩm cũ khi sửa đơn mua/bán tiếp tục theo chính sách sẵn có.
- Import Excel thêm bốn cột Có/Không ở cuối. Ô thiếu/trống khi cập nhật giữ nguyên cờ; khi tạo lấy mặc định theo loại. Các dòng cùng mã phải thống nhất khả năng.

## Chuyển đổi và triển khai

Migration: `prisma/migrations/20261016090000_product_capabilities/migration.sql`.

- Mọi mã cũ tiếp tục được mua/bán như trước.
- Khởi tạo làm nguyên liệu cho NVL/Hàng hóa/Phụ kiện; được sản xuất cho Thành phẩm/Phụ kiện. Sau đó quản lý bật thêm khả năng cần thiết trên sản phẩm cụ thể.
- Dòng đơn đã ghi sổ lấy cách xuất từ `bomVersionId`. Đơn nháp cũ giữ `LEGACY` để tương thích.
- Không đổi chứng từ, số lượng tồn hoặc giá FIFO trong migration.
- Khi phát hành: áp migration bằng quy trình deploy của dự án trước khi chạy phiên bản ứng dụng mới; Prisma Client cần được generate từ schema mới.
- Workflow `Deploy` khi push `main` tự build image app và migrator cùng commit, chạy `prisma migrate deploy` và seed trước khi đổi container app. Migration/seed lỗi thì giữ container cũ; health check đạt mới báo deploy thành công. Image migrator chứa file `src/server/products/capabilities.ts` dùng bởi seed.

## Kiểm tra nghiệp vụ

- A tồn 100, bán 30, dùng 20 sản xuất B: tồn A còn 50; giá vốn B nhận đúng vốn của 20 A.
- Thành phẩm không bật làm nguyên liệu bị từ chối; bật nhưng thiếu tồn bị từ chối.
- Xuất từ tồn với kiểu gia công/BOM vẫn chỉ trừ A; chọn BOM chỉ trừ nguyên liệu.
- Bộ lọc khả năng không phụ thuộc loại; đổi loại giữ các cờ đã lưu.
- Import cũ không xóa cấu hình mới; import Có/Không và export khứ hồi giữ cờ.
