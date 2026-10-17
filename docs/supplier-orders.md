# Đặt hàng nhà cung cấp

Vào **Nhập hàng → Đặt hàng nhà cung cấp** (`/purchase/supplier-orders`).

1. Tạo đơn nháp: nhà cung cấp, sản phẩm, số lượng/đơn vị, giá dự kiến, dự kiến giao từng dòng, ghi chú và ảnh trao đổi (tối đa 3 ảnh, mỗi ảnh 700 KB).
2. Đặt qua Zalo rồi đánh dấu **Đã gửi nhà cung cấp**. Người tạo được ghi tự động.
3. Người nhận bấm **Nhận hàng**. Các đơn còn chờ của cùng nhà cung cấp xuất hiện cùng nhau; nhập số lượng thực nhận vào đúng mã đơn, để trống dòng chưa giao.
4. Xác nhận tạo một phiếu nhập kho bằng engine hiện có, đồng thời ghi công nợ và thông báo cho từng người đặt. Một đơn có thể nhận nhiều lần; một phiếu nhập có thể nhận cho nhiều đơn cùng nhà cung cấp.
5. Đã nhận một phần/đủ tính tự động từ phiếu nhập chưa hủy. Nhận thừa phải có lý do; sản phẩm không nằm trong đơn bị từ chối. Giao sai ghi chú chênh lệch và không nhập vào dòng đặt đúng.
6. Hủy đơn chỉ khi chưa nhận. Đóng phần còn thiếu cần lý do. Hủy phiếu nhập sẽ tính lại tiến độ và thông báo cho người đặt.

Giá nhập gần nhất lấy từ phiếu nhập còn hiệu lực của đúng sản phẩm và nhà cung cấp, kèm đơn vị và ngày nhập. Giá tham khảo, giá đặt và giá thực nhận được phân biệt.

Quyền kế thừa nhóm nhập hàng: `purchase.view`, `purchase.create`, `purchase.edit`, `purchase.cancel`, `purchase_price.view`. Các màn hình đơn đặt yêu cầu xem giá nhập; thao tác ghi nhận kho tiếp tục dùng quyền lập phiếu nhập. Không thêm bước duyệt và không tự gửi tin Zalo.

Phiếu nhập liên kết đơn đặt không sửa trực tiếp dòng hàng; hủy rồi nhận lại để bảo toàn đối chiếu. Cước vẫn được sửa bằng chức năng hiện có. Đơn nháp nhập sai thông tin hàng có thể hủy và lập lại; ngày dự kiến giao có thể cập nhật trên đơn đang mở.

Triển khai cần áp dụng migration `20261017100000_supplier_orders`, sinh Prisma Client và build ứng dụng như quy trình hiện có. Chưa tự áp dụng migration lên dữ liệu thật hoặc deploy VPS.
