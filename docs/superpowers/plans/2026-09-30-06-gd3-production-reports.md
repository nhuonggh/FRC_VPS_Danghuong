# Plan 06 — GĐ3: sản xuất, gia công thuê, kiểm kho, báo cáo

Trạng thái: **E5 (báo cáo 67–71, 73) đã code**. E1–E4 và báo cáo 72 **chờ khách trả lời** (xem `DATA-REQUEST.md`).

| Task | Nội dung | Phụ thuộc |
|---|---|---|
| E1 | Lệnh sản xuất phụ kiện (mã 49, 50) — **xong (giá thành mặc định = Σ vốn NVL)**: trừ NVL theo định mức, nhập thành phẩm bằng layer `PRODUCTION_OUT` với `costRef` = tổng vốn NVL + chi phí nhân công/khác | Khách xác nhận cách tính giá thành, định mức phụ kiện |
| E2 | Tiêu hao thực tế (52, 53): so sánh định mức với thực dùng, chênh lệch ghi hao hụt | E1 |
| E3 | Gia công thuê (54, 55): khách đưa tôn, xưởng chỉ thu công; không trừ tồn tôn cuộn của xưởng | Khách xác nhận bảng giá công |
| E4 | Kiểm kho + điều chỉnh hao hụt (26–28): phiếu kiểm, chênh lệch → `StockAdjustment` qua engine | Khách xác nhận quy trình kiểm | — **xong**
| E5 | Báo cáo 67–71, 73 — **xong** | — |
| E6 | Báo cáo 72 (sản xuất) | E1, E2 |

Ràng buộc: mọi ghi kho qua `src/server/inventory/index.ts`; mọi ghi sổ tiền qua `postPartnerLedger`/`postCashLedger`; cập nhật `docs/STATUS.md` cùng commit.
