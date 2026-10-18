# Phân tích giá vốn tham khảo tôn gia công — 18/10/2026

Trạng thái: đề xuất để duyệt nghiệp vụ, chưa triển khai code tính giá mới.

## Kết quả kiểm tra hiện tại

`src/server/sales/cost-reference.ts` lấy định mức theo sản phẩm, kiểu gia công và ngày đơn. Với chế độ BOM, giá tham khảo là tổng lượng từng nguyên liệu trong định mức nhân giá nhập gần nhất của nguyên liệu đó tại ngày đơn. Không tự cộng thêm giá nhập của mã tôn đang bán. Giao diện ghi rõ chưa gồm nhân công và chi phí khác.

Vì vậy nếu định mức chỉ có ISO, POLY, giấy bạc thì con số hiện tại chỉ gồm các vật liệu đó. Cần kiểm tra cấu hình định mức thật trước khi kết luận dữ liệu sai. Chưa truy vấn dữ liệu production trong lần phân tích này.

`src/server/sales/issue-by-bom.ts` cũng xuất kho theo chính các dòng định mức, không tự xuất mã thành phẩm đang bán. Nếu tôn đầu vào chưa nằm trong định mức thì cần kiểm tra cả việc xuất tôn và giá vốn thực tế của các đơn liên quan; sửa con số hiển thị không tự sửa sổ kho. Không tự điều chỉnh đơn cũ.

Hệ thống đã có tỷ lệ m²/m dài riêng theo sản phẩm và kiểu gia công. Giá lưu theo đơn vị gốc; giao diện chia tỷ lệ để hiển thị theo m².

## Mô hình tính đề xuất

Giá vốn tham khảo đầy đủ = giá tôn đầu vào + vật liệu phụ theo định mức + chi phí gia công dự kiến. Mọi thành phần phải quy về cùng một đơn vị trước khi cộng.

Với r là số m² trên 1 m dài, đơn giá tôn 44.322 đ/m² và phí gia công 2.000 đ/m dài:

- Chỉ tôn + phí: giá/m² = 44.322 + 2.000/r; giá/m dài = 44.322 × r + 2.000.
- Nếu r = 1: 46.322 đ/m².
- Nếu r = 1,08: khoảng 46.174 đ/m², tương ứng 49.867,76 đ/m dài (trước làm tròn hiển thị).
- Nếu giữ thêm 32.375 đ/m² vật liệu phụ như ảnh và r = 1,08: khoảng 78.549 đ/m². Đây là ví dụ có điều kiện, không phải kết luận giá đúng cho mã hàng.

Không cộng thẳng 44.322 + 2.000 nếu đơn vị khác nhau. Không cộng thêm vật liệu phụ nếu giá cố định nhập vào đã bao gồm chúng. Không cộng tôn lần hai nếu BOM đã có tôn.

## Cấu hình và giao diện đề xuất

Tại sản phẩm × kiểu gia công, bổ sung cấu hình giá tham khảo có ngày hiệu lực:

1. Tôn đầu vào: chọn mã nguyên liệu có tìm kiếm, lượng tiêu hao/hệ số tương ứng; có thể dùng giá nhập theo ngày hoặc đơn giá kế hoạch cố định. Giá kế hoạch không ghi đè giá nhập hay giá tồn kho.
2. Vật liệu phụ: tiếp tục lấy từ BOM đang hiệu lực. Phân biệt rõ cấu hình đã bao gồm tôn hay chưa, tránh cộng trùng.
3. Chi phí gia công: có thể khởi đầu bằng một mức gộp (ví dụ 2.000 đ/m dài), sau này tách nhân công và chi phí khác. Mỗi mức phải có đơn vị rõ ràng (đ/m dài hoặc đ/m²). Có thể có mặc định theo kiểu gia công, ghi đè theo sản phẩm.
4. Nếu muốn nhập một giá gộp toàn bộ, dùng chế độ riêng và liệt kê rõ những thành phần đã bao gồm; không cộng ngầm với BOM.

Trên màn bán hàng hiển thị tổng và chi tiết: tôn đầu vào / vật liệu phụ / nhân công / chi phí khác / nguồn giá / ngày hiệu lực / đơn vị. Thiếu giá nguyên liệu hoặc tỷ lệ quy đổi phải báo chưa đủ dữ liệu, không ngầm tính bằng 0. Chi phí chưa cấu hình cần được phân biệt với mức 0 đã xác nhận.

Thông tin này là dự toán để tham khảo và cảnh báo giá bán; không tự đổi FIFO, giá xuất kho, giá bán hoặc bút toán kế toán. Cảnh báo bán dưới vốn phải dùng cùng tổng đã quy đổi. Quyền xem giá nhập/giá vốn và phân tích đơn hàng tiếp tục áp dụng ở server.

## Dữ liệu và phạm vi triển khai dự kiến

Đã có: Product, ProcessingType, ProductProcessingRatio, Bom/BomVersion/BomLine và CostLayer. Chưa có cấu hình giá tôn cố định, chi phí gia công và phiên bản giá tham khảo trong mô hình này.

Đề xuất thêm bảng cấu hình giá dự toán có phiên bản theo (sản phẩm, kiểu gia công, ngày hiệu lực), thay vì gắn phí tiền vào BomLine vốn dùng để xuất vật tư. Giá và tỷ lệ dùng Decimal. Nếu cần tra lại dự toán khi lập đơn thì chụp các thành phần và nguồn giá vào snapshot của dòng đơn; thay đổi cấu hình sau này không viết lại đơn cũ. Cần migration, audit và bộ kiểm thử quy đổi, thiếu dữ liệu, chống cộng trùng, quyền truy cập và hồi quy sổ kho/FIFO.

Nên tách hai việc: (A) kiểm tra/sửa cấu hình định mức tôn thực tế; (B) phát triển cấu hình giá kế hoạch và phí dự toán. Đơn cũ thiếu xuất tôn cần một phương án đối soát riêng sau khi xác định ảnh hưởng, không tự chạy migration để viết lại lịch sử.

## Các điểm cần chốt trước khi code

1. 44.322 đ/m² là giá riêng tôn đầu vào hay giá gộp tôn xốp đã có vật liệu phụ? Giá này đã gồm những khoản nào?
2. 2.000 đ/m là trên mét dài thành phẩm, và là tổng gia công hay chỉ nhân công? Tỷ lệ m²/m dài thực tế của kiểu trong ảnh là bao nhiêu?
3. Tôn nào được xuất kho cho tôn xốp, lượng tiêu hao/hao hụt thế nào, và BOM hiện tại đã có dòng tôn chưa?

Khuyến nghị: lấy giá riêng tôn + BOM vật liệu phụ + phí gia công gộp có đơn vị và ngày hiệu lực; cho chọn nguồn giá tôn là nhập gần nhất hoặc giá kế hoạch cố định. Không triển khai phép cộng giá mới cho đến khi chốt ba điểm trên.
