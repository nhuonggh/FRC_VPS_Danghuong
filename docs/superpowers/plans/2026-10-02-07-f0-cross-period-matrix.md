# Plan 07 — F0: ma trận chứng từ xuyên kỳ (đã chốt hành vi hiện tại)

Nguồn kiểm: `tests/period/cross-period-matrix.test.ts` (28 ca, chạy trên DB thật). Quy tắc gốc: spec 4.4 — **chứng từ của kỳ đã kết sổ không sửa/hủy; mọi điều chỉnh đi bằng chứng từ MỚI ở kỳ mở**. Đổi hành vi nào ⇒ sửa test và bảng này cùng commit.

Kịch bản kiểm: chứng từ sinh ở kỳ A → kỳ A `CLOSED`, kỳ B `OPEN` → thao tác lên chứng từ của A.

## 1. Bị chặn (PeriodClosedError / 409 "kỳ đã kết sổ")

| Nhóm | Thao tác bị chặn |
|---|---|
| Tiền | sửa/hủy phiếu thu, phiếu chi; **trả lại phiếu (mới vá)**; yêu cầu điều chỉnh phiếu đã kiểm; duyệt/từ chối yêu cầu điều chỉnh; sửa chi phí; hủy/nhả tiền cọc; **hủy lần chốt quỹ (mới vá)** |
| Công nợ | hủy điều chỉnh công nợ; hủy chuyển/gộp công nợ; hủy tất toán chiết khấu |
| Bán hàng | hủy đơn; xác nhận đơn nháp kỳ cũ; hủy phiếu giao |
| Kho | hủy phiếu nhập; hủy phiếu trả hàng; hủy lệnh sản xuất (đi qua engine, khoá `FOR SHARE` dòng kỳ) |
| Giao hàng | xuất phát / hủy chuyến của kỳ cũ |

Hai lỗ hổng tìm thấy khi lập ma trận và đã vá trong cùng đợt:
- `returnVoucher`: thủ quỹ trả lại phiếu của kỳ đã đóng ⇒ kế toán không sửa được nữa ⇒ phiếu kẹt vĩnh viễn. Nay chặn; hậu kiểm (REVIEW) vẫn cho.
- `voidCashClose`: hủy lần chốt quỹ của kỳ đã đóng làm đổi báo cáo kỳ cũ. Nay chặn.

## 2. Được phép có chủ đích

| Thao tác | Kết quả |
|---|---|
| Hậu kiểm phiếu thu/chi kỳ cũ | Cho — chỉ đổi cờ kiểm tra, không đổi số |
| Hậu kiểm tất toán chiết khấu kỳ cũ | Cho — như trên |
| Thu nợ theo đơn kỳ cũ | Phiếu thu MỚI mang `periodId` kỳ mới; đơn giữ kỳ cũ |
| Báo giá kỳ cũ → chuyển thành đơn | Đơn nháp MỚI thuộc kỳ mở |
| Trả hàng theo đơn kỳ cũ | Có test ở `tests/returns` (giá vốn dòng bán gốc, phiếu mang kỳ mới) |

## 3. Quyết định F1b/F1d còn mở (cần user/khách chốt trước khi viết engine)

| # | Vấn đề | Hiện tại | Đề xuất |
|---|---|---|---|
| X1 | **Giao nốt đơn kỳ cũ** (đơn chưa giao đủ khi kết sổ): tạo phiếu giao / xếp chuyến cho đơn kỳ cũ | Bị chặn (`lockOrderForDelivery`, `createTrip`) ⇒ đơn kẹt | Checklist đang CẢNH BÁO (`undelivered-orders`). Đề xuất F1d **mở** giao nốt: phiếu giao + công nợ ghi ở kỳ mới, kho đã xuất lúc xác nhận nên không đụng FIFO. Nếu không mở ⇒ đổi cảnh báo thành chặn cứng |
| X2 | Báo giá DRAFT/SENT lúc kết sổ | Sửa được, không bị chặn kỳ (không giữ kho/tiền) | F1b **mang sang kỳ mới** (đổi `periodId`) cùng đơn nháp; báo giá đã chốt thì bất biến. Checklist cảnh báo `open-quotes` |
| X3 | Đơn nháp lúc kết sổ | Chặn sửa ở kỳ cũ | F1b mang sang kỳ mới (mặc định #4 của plan) |
| X4 | Phiếu chờ hậu kiểm lúc kết sổ | Hậu kiểm vẫn làm được ở kỳ cũ | Cảnh báo `pending-review`; phiếu BỊ TRẢ LẠI / yêu cầu điều chỉnh đang chờ ⇒ **chặn cứng** (không xử lý được sau kết sổ) |
| X5 | Chuyến PLANNED lúc kết sổ | Chặn kết sổ (mọi chuyến chưa CONFIRMED/CANCELLED) | Giữ — an toàn hơn "mang chuyến sang kỳ mới" (plan F1b ghi mang chuyến mở; ta chặn nên không cần) |

## 4. Rà điểm "kỳ" trong code (kết quả)

Mọi hàm ghi chứng từ gọi `getOpenPeriod`/`lockPeriodForEngine`; mọi hàm sửa/hủy so `periodId` chứng từ với kỳ mở. Ngoại lệ cố ý: hậu kiểm (§2), ghi nhận "đã xử lý" hàng không giao được (`handleStop` — chỉ ghi chú), sửa báo giá (§3 X2). Báo cáo/danh sách lọc theo kỳ mở (`getOpenPeriod`) — xem kỳ cũ là việc của F2.
