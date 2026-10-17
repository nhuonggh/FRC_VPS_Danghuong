# Giá vốn tham khảo khi bán hàng

Ô **Giá vốn tham khảo** thay vị trí giá nhập gần nhất ở phần chọn sản phẩm và xuất hiện gọn trong mỗi dòng hàng. Không thêm cột, bước xác nhận hoặc thao tác bắt buộc.

- **Xuất tồn sản phẩm:** giá nhập mua hoặc giá thành sản xuất gần nhất đến ngày đơn. Nguồn mới nhất được hiển thị chính, kèm mã chứng từ và ngày; nếu có cả hai nguồn thì nguồn còn lại nằm trong **Chi tiết giá vốn**.
- **Gia công theo định mức:** dùng phiên bản định mức có hiệu lực theo ngày đơn và đúng kiểu gia công. Giá dự kiến bằng tổng định mức nguyên liệu nhân giá nhập gần nhất của từng nguyên liệu. Chỉ tính nguyên vật liệu, chưa gồm nhân công và chi phí khác.
- **Theo kiểu gia công:** giữ nguyên cơ chế hiện có: có định mức thì tham khảo định mức, không có thì tham khảo giá của sản phẩm xuất tồn.
- Thiếu giá nguyên liệu thì báo rõ nguyên liệu còn thiếu, không tự coi bằng 0 hoặc thay bằng giá của sản phẩm gốc. Đổi ngày đơn hoặc cách xuất kho thì tải lại giá tham khảo.
- Giá hiển thị theo đúng đơn vị bán, bao gồm quy đổi m² qua tỷ lệ đã khai báo. Thông tin nguyên liệu thu gọn mặc định, chỉ mở khi người dùng cần đối chiếu.
- Giá nhập tuân theo `purchase_price.view`; giá thành sản xuất theo `cost.view`; dự kiến định mức cần cả hai quyền. Liên kết chứng từ chỉ hiện khi có quyền xem màn hình tương ứng.
- Toàn bộ phần giá vốn tham khảo trong bán hàng còn cần `order.analysis.view`: admin mặc định được xem, kế toán mặc định tự ẩn; quyền nhập hàng của kế toán vẫn giữ nguyên.
- Cảnh báo giá bán thấp hơn giá vốn dùng cùng nguồn tham khảo đang hiển thị. Giá tham khảo không tự đặt giá bán, không ghi tồn kho và không sửa giá vốn FIFO/chứng từ cũ.

Không thay đổi cấu trúc cơ sở dữ liệu, không cần migration mới.
