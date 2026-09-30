# Plan 07 — GĐ4: kết sổ cuối kỳ, tra cứu kỳ cũ, kiểm thử toàn bộ, bàn giao

Tiền đề: plan 03–06 đã vào `main` và chạy trên VPS (deploy #47 + #48). Còn nợ từ plan 06: E3 gia công thuê (chờ bảng giá công), in M6/M9 (chờ Google Doc mẫu). Hai việc này KHÔNG chặn plan 07 nhưng kết sổ phải xử lý được cả chúng khi có (checklist mở rộng được).

Nguồn: spec §4 (K5), engine-fifo §OPENING, mục 31 “Engine kết sổ + quy tắc xuyên kỳ”.

## Thứ tự làm

| Task | Nội dung | Ước lượng | Phụ thuộc |
|---|---|---|---|
| **F0** | Chuẩn bị: rà điểm “kỳ” trong code (mọi truy vấn lọc `periodId`, guard `getOpenPeriod`), danh sách chứng từ mang sang kỳ mới (đơn nháp, chuyến mở), viết test khung xuyên kỳ | 2 ngày | — |
| **F1a** | **Checklist điều kiện kết sổ** (spec 4.2): chặn — đơn `is_provisional`, chuyến chưa đối soát/thủ quỹ chưa xác nhận, phiếu kiểm kho DRAFT, (sau này) lệnh/gia công dở; cảnh báo — đơn nháp, tiền cọc chưa dùng, chiết khấu chưa đối chiếu. Trang `/period/close` hiện từng mục xanh/đỏ/vàng kèm link tới chứng từ vướng | 3 ngày | F0 |
| **F1b** | **Engine kết sổ** (1 transaction): chốt số cuối kỳ (tồn + lớp giá còn lại, công nợ từng đối tác, số dư quỹ/ngân hàng, chiết khấu tích lũy) → sinh `opening_*` kỳ mới (chuyển tiếp, không về 0) → lô tồn cuối kỳ thành lớp `OPENING` kỳ mới **giữ nguyên từng lô** (mặc định, chờ khách xác nhận) → kỳ cũ CLOSED, tạo kỳ mới OPEN → mang đơn nháp/chuyến mở sang kỳ mới (đổi `periodId`). Qua engine FIFO (chỉ `src/server/inventory/index.ts`), audit đầy đủ, khoá cứng kỳ cũ | 6 ngày | F1a |
| **F1c** | **Xác nhận 2 bước** (chỉ Giám đốc, quyền `period.close`): bước 1 xem trước số cuối kỳ + số đầu kỳ mới; bước 2 gõ lại tên kỳ để xác nhận; chặn bấm đôi (advisory lock + idempotency); tự chụp **backup ngay trước khi kết** (gọi `backup.sh` hoặc bắt buộc có backup < 24 giờ) | 2 ngày | F1b |
| **F1d** | **Quy tắc xuyên kỳ** (spec 4.4): không sửa/hủy chứng từ kỳ đóng (đã có guard — bổ sung test toàn diện); vẫn tạo chứng từ mới ở kỳ mở liên quan đơn cũ: giao nốt, thu nợ, trả theo đơn kỳ cũ (giá vốn dòng bán gốc, chứng từ mang kỳ mới); hủy đơn có chiết khấu tích lũy xuyên kỳ | 4 ngày | F1b |
| **F2** | **Tra cứu kỳ cũ + chọn kỳ làm việc**: danh sách kỳ, xem chỉ đọc (báo cáo XNT, công nợ, quỹ, đơn theo kỳ), màn làm việc mặc định kỳ mở, banner “đang xem kỳ cũ – chỉ đọc”, mọi nút ghi bị ẩn ở kỳ cũ | 4 ngày | F1b |
| **F3** | **Kiểm thử toàn bộ + diễn tập**: test 3.7 (“kết sổ mang lô sang kỳ mới”, “hủy đơn có chiết khấu tích lũy”), kiểm chứng tổng tồn/công nợ/quỹ **bằng nhau trước và sau kết sổ**, hiệu năng kết sổ với ~1.300 SP + vài chục nghìn dòng; **diễn tập trên bản sao DB thật** (restore-drill) trước lần kết sổ đầu tiên; đào tạo đợt 2 | 5 ngày | F1, F2 |
| **F4** | **Tài liệu vận hành + bàn giao**: RUNBOOK kết sổ, khôi phục sự cố, quy trình cuối tháng, bàn giao mã nguồn + quyền quản trị (T8), danh sách bí mật cần xoay | 3 ngày | F3 |

Tổng ~29 ngày công (trong khung 34–50 của kế hoạch tổng, còn dư cho sửa lỗi sau chạy song song).

## Cổng chất lượng (bắt buộc trước khi nói “xong”)

1. **Bất biến kết sổ** (test tự động, chạy trên dữ liệu ngẫu nhiên + dữ liệu mẫu lớn): Σ tồn từng mã, Σ giá trị tồn, số dư công nợ từng đối tác, số dư từng quỹ, số dư chiết khấu — *trước* = *đầu kỳ mới*. Không mã nào đổi giá vốn bình quân theo lô.
2. Kết sổ hai lần liên tiếp / hai người bấm cùng lúc ⇒ chỉ một kỳ mới được tạo.
3. Lỗi giữa chừng ⇒ rollback toàn bộ (kỳ cũ vẫn OPEN, không có `opening_*` mồ côi).
4. Sau kết sổ: sửa/hủy chứng từ kỳ cũ bị chặn ở cả API lẫn giao diện; báo cáo kỳ cũ giữ nguyên số.
5. Diễn tập trên bản sao DB thật + so sánh số trước/sau do **người dùng xác nhận** trước lần kết sổ thật.

## Câu hỏi cần khách trả lời (nếu chưa có, dùng mặc định)

| # | Câu hỏi | Mặc định nếu chưa trả lời |
|---|---|---|
| 1 | Lô tồn cuối kỳ: giữ nguyên từng lô hay gộp một lô bình quân? | Giữ nguyên từng lô |
| 2 | Kết sổ theo tháng hay quý? (ảnh hưởng thói quen; hệ thống hỗ trợ cả hai) | Tháng |
| 3 | Ngày giờ chốt: 24:00 ngày cuối tháng hay theo phiếu kiểm kho cuối tháng? | Giờ kết sổ thực tế (ghi vào nhật ký) |
| 4 | Đơn nháp / chuyến chưa xong lúc kết sổ: mang sang hay bắt xử lý hết? | Nháp mang sang; chuyến đang chạy chặn kết sổ |
| 5 | Ai được kết sổ ngoài Giám đốc? | Chỉ Giám đốc |

## Rủi ro và cách chặn

- **Kết sổ sai lệch cả kỳ** → checklist chặn cứng + xác nhận 2 bước + backup tự động trước + diễn tập trên bản sao + bất biến tự kiểm sau khi kết (nếu lệch thì rollback).
- **Kết sổ quá lâu/khoá bảng lâu** → tính bằng SQL tập hợp, không lặp từng dòng trong Node; đo trước với dữ liệu lớn; chạy ngoài giờ.
- **Chứng từ xuyên kỳ gây lệch FIFO** → không tạo lại lịch sử lô cũ; lớp `OPENING` kỳ mới giữ `unitCost`/`qty` từng lô, trả hàng theo đơn kỳ cũ dùng giá vốn dòng bán gốc đã lưu.
- **Khoá cứng làm khách kẹt việc** (cần sửa số cũ) → đường sửa duy nhất: chứng từ điều chỉnh ở kỳ mới (đã có cho tiền/công nợ/kho); không mở khoá kỳ cũ.

## Việc song song không thuộc plan 07

E3 gia công thuê, in M6/M9, xuất Excel nhập tồn thực đếm, tự điền NVL từ định mức cho lệnh SX — làm khi khách trả lời; không chặn kết sổ.
