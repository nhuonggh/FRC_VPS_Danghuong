# Chi tiết đơn hàng theo quyền

Giao diện tham khảo `Template/ThongtinDonhang.html`: tóm tắt đơn bên trái, thông tin cơ bản và các phần nghiệp vụ bên phải; nhãn ở trên giá trị; bảng dòng hàng gọn, có STT. Trên điện thoại bảng chuyển thành thẻ. Tóm tắt bên trái giữ vị trí khi cuộn trên PC.

Điều hướng có **Tất cả** (mặc định, `?tab=all`) để xem mọi phần. Chọn từng mục chỉ hiển thị đúng phần đó, kể cả khi mở trực tiếp URL `?tab=info`, `lines`, `delivery`, `deposits`, `history`. Đổi mục đưa vùng nội dung về đầu. Trên PC khung nội dung và khung tóm tắt cuộn độc lập trong chiều cao còn lại của màn hình; mobile giữ cơ chế cuộn trang và thanh chọn mục ngang.

Không tạo tab quản trị riêng và không có nút tự bật/tắt giá vốn. Tài khoản có `order.analysis.view` tự thấy phần định mức/giá vốn/lợi nhuận theo các quyền dữ liệu tương ứng; tài khoản thiếu quyền tự ẩn toàn bộ phần đó.

- Kế toán vẫn thấy sản phẩm, ghi chú kích thước, kiểu gia công, số lượng, đơn vị, đơn giá, chiết khấu và thành tiền; giao hàng/thu cọc giữ quyền nghiệp vụ hiện có.
- Admin thấy thêm cột giá vốn/lãi và tổng lãi dòng. Nguyên liệu/định mức thu gọn mặc định, mở ngay tại dòng khi cần.
- Server loại bỏ định mức, danh sách nguyên liệu, giá vốn và lãi khỏi DTO của người không được phép. Giá vốn tham khảo khi lập/sửa đơn, báo cáo lợi nhuận, báo cáo xuất kho theo đơn và nhật ký đơn hàng áp dụng cùng giới hạn. Bản in hóa đơn vốn không có giá vốn/lãi.
- Quyền xem giá nhập ở chức năng nhập hàng không bị thu hồi, tránh ảnh hưởng công việc của kế toán.

Migration `20261017120000_order_analysis_access` tạo quyền mới và cấp cho nhóm Giám đốc hoặc nhóm đã có quyền quản trị nhóm quyền (`role.manage`). Nhóm Kế toán thông thường không được cấp. Không thay đổi số liệu đơn hàng, FIFO, công nợ hay chứng từ.

Quyền hiệu lực là hợp quyền của các nhóm mà tài khoản tham gia; tài khoản vừa thuộc Kế toán vừa thuộc nhóm quản trị vẫn được xem phần quản trị. Có thể điều chỉnh quyền này tại cấu hình nhóm quyền khi thật sự cần.
