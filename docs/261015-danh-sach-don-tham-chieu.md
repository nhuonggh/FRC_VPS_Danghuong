# Danh sách đơn theo mẫu HTML

Tham chiếu: `Template/Danh sách đơn – Danh sách đơn.html` (mẫu bundle HTML, đọc template và logic đóng gói, không thực thi script đi kèm).

- Bổ sung tiêu đề mô tả, bốn thẻ tổng quan và sáu tab có số lượng: Tất cả, Chưa đủ tồn, Trễ giao, Đã giao, Không giao được, Chưa thanh toán. Số thẻ/tab là tổng trong phạm vi được xem; số kết quả ở phân trang theo toàn bộ bộ lọc.
- Tab trạng thái giữ tìm kiếm/ngày/nhóm khách nhưng xóa điều kiện trạng thái xung đột và về trang 1.
- Bộ lọc mở khi cần, nhập rồi Áp dụng: mã đơn, tên/mã khách, nhóm khách, người tạo, giao hàng, thanh toán, ghi nhận xuất kho, thời gian và số dòng mỗi trang. Nhóm/người tạo dùng combobox có tìm kiếm. Mobile dùng bottom sheet, Escape đóng và bỏ thay đổi chưa áp dụng.
- Gộp ngày lập dưới mã đơn, ngày giao/cảnh báo trễ dưới trạng thái giao. Các cột ngày độc lập vẫn có thể bật lại/sắp xếp qua Cột hiển thị. Mobile hiển thị khách, phải thu/tổng phải trả theo quyền và cả hai trạng thái.
- Nút in mở bản in riêng cho trang hiện tại, giữ query và kiểm tra lại quyền phía server. Không ngụ ý in toàn bộ kết quả khi chỉ đang xem một trang.
- Không sao chép dữ liệu demo/màu hardcode của mẫu. Không thêm mã PO, loại khách cá nhân/doanh nghiệp vì schema chưa có. Trạng thái xuất kho dùng `isDraft`: đơn đã xác nhận có thể vẫn còn phần xuất FIFO tạm (chưa đủ tồn), nhãn hiển thị nói rõ việc xác nhận thay vì khẳng định đã đủ hàng.
- Giữ tính công nợ trước ngày đơn, phân quyền giá bán/công nợ và phạm vi khách phụ trách như hiện tại. Không đổi schema.
