# Kiểm tra hằng ngày và xuất báo cáo Trang chủ

- Trang chủ → **Kiểm tra hằng ngày**, mặc định Hôm nay (UTC+7).
- 11 mục chia ba nhóm. Chọn mục để mở danh sách đầy đủ, tìm kiếm, lọc ngày/trạng thái và phân trang; PC dùng bảng, mobile dùng thẻ.
- **Xuất báo cáo** trên danh sách tổng hợp: workbook gồm thông tin, tổng hợp và chi tiết các mục được phép xem. **Xuất mục này** trong chi tiết giữ nguyên bộ lọc, bỏ phân trang.
- Các tab tổng quan khác có **Xuất báo cáo**, xuất chỉ số và dữ liệu biểu đồ/bảng của tổng quan. Bảng gần đây/Top giữ giới hạn như giao diện; file ghi rõ phạm vi. Dùng Kiểm tra hằng ngày để xuất toàn bộ chứng từ.
- Không đổi schema hay quy trình ghi chứng từ.

## Quy ước dữ liệu

Ngày lọc là ngày nghiệp vụ (`at`, riêng đơn bán là `orderDate`), khoảng nửa mở theo giờ Việt Nam. Mặc định chỉ chứng từ hiệu lực; chọn đã hủy để xem lại, tổng tiền không cộng chứng từ đã hủy.

Trả theo đơn loại phiếu `undelivered`; phiếu này nằm riêng ở Hàng không giao được trả kho. Số đơn còn cần giao lại/trả kho là trạng thái hiện tại, không lọc ngày, dựa trên số lượng còn lại của từng dòng sau giao và trả kho; trả một phần vẫn còn cần xử lý.

Chiết khấu trực tiếp là tổng `discountNow`, không cộng lại `orderDiscount` đã phân bổ. Tích lũy là tổng `discountAccum`; không tính đơn nháp. Tất toán tách CASH/OFFSET. Công nợ tách tăng/giảm số dư đối tác. Hao hụt mặc định LOSS, có thể chọn WRITE_OFF; giá vốn lấy `cost_consumptions`, không lấy `stock_adjustment_lines.unitCost` (cột này bằng 0 cho phiếu xuất). Không cộng số lượng khác đơn vị hoặc cộng tiền xuyên các mục.

Quyền mục và quyền giá được kiểm tra phía server cho cả giao diện và Excel. Phạm vi khách phụ trách dùng cùng quy tắc của module; NCC/thu chi/nhập hàng và giao hàng theo phạm vi hiện có của module. Chưa tải được hiển thị lỗi, không trả số 0 giả.

Excel tối đa 10.000 chứng từ/mục, 30.000 cho bộ báo cáo. Vượt giới hạn trả thông báo yêu cầu thu hẹp bộ lọc, không xuất thiếu. Tên cột tiếng Việt, tiền dạng số VND, ngày dd/mm/yyyy, chống chuỗi công thức qua helper Excel dùng chung.
