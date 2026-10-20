# Sổ quỹ tiền mặt — yêu cầu khách chờ chốt (20/10/2026)

**Trạng thái: ĐÃ CODE theo phương án A–D (21/10/2026), chưa deploy.** Các câu hỏi bên dưới vẫn mở: nếu khách trả lời khác thì chỉnh. Mặc định đã làm: người kiểm tra = người bấm kiểm phiếu (+ người chốt quỹ ở báo cáo); người nộp/nhận = đối tác, phiếu chi không đối tác thì lấy người ứng tiền; Excel báo cáo quỹ đã có (2 sheet); phiếu chi phí hiện tên loại chi phí ở cột người nộp/nhận (khách xác nhận 21/10).

Đã làm: migration `20261021120000_cash_top_up` + `20261021120100_cash_top_up_constraint` (loại phiếu thu `BO_SUNG_QUY`, không đối tác/đơn/công nợ); 3 cột + Excel ở sổ quỹ; trang `/accounting/cashreport` ([report.ts](../../src/server/cash/report.ts)); test `tests/cash/report.test.ts`.

## Yêu cầu của khách (nguyên văn rút gọn)

1. Thêm 3 cột vào Sổ quỹ tiền mặt: **Nội dung thu/chi**, **Người nộp/nhận**, **Người kiểm tra**.
2. Cách làm việc: sáng giám đốc đưa ~10tr vào quỹ "KẾ TOÁN - QUỸ TIỀN MẶT" để kế toán thu/chi (trả tiền thừa, chi phí, nhập hàng đơn nhỏ). Đơn to quỹ không đủ thì kế toán xin giám đốc bổ sung quỹ. **Kế toán tự nhập số dư đầu ngày và khoản bổ sung quỹ.**
3. Chủ quỹ (người kiểm tra) chốt số liệu **sáng hôm sau** cho ngày hôm trước (đi muộn, về sớm hơn kế toán). Yêu cầu: **chưa chốt hôm qua vẫn nhập được số dư đầu ngày hôm nay.**
4. Cần **báo cáo theo ngày** và **theo người kiểm tra** (người kiểm tra = người thu tiền thực tế; hai người, mẹ và con, thay nhau làm).

## Hiện trạng code (đã đọc)

- Sổ quỹ: [CashBook.tsx](../../src/components/cash/CashBook.tsx), dữ liệu [queries.ts](../../src/server/cash/queries.ts) `listCashBook`. Cột hiện có: Ngày, Chứng từ, Kiểm tra (trạng thái), Thu, Chi, Số dư.
- `Receipt` / `Payment` đã có sẵn: `note`, `partnerId`, `reviewedBy`, `reviewedAt`, `createdBy`, `advancedById` (chỉ Payment). `cash_ledger` chỉ có số tiền, docType/docId, `createdBy`. => 3 cột mới **không cần migration**, chỉ join thêm.
- **Chốt quỹ** ([close.ts](../../src/server/cash/close.ts)) chỉ là snapshot đối chiếu (sổ vs kiểm đếm): *không khóa chứng từ, không chặn nhập*. Nên về nguyên tắc kế toán đã nhập được khi chưa chốt hôm qua.
- **Số dư đầu kỳ** là `opening_cash` theo **kỳ × quỹ** (một số duy nhất cho cả kỳ), không có "số dư đầu ngày". Phần "đầu ngày" khách mô tả hiện chỉ biểu diễn được bằng phiếu thu loại KHAC (bổ sung quỹ), chưa có loại/nhãn riêng.
- `cashBalance` có `asOf`, và "đã kiểm tra / chờ kiểm tra" theo `reviewStatus` từng phiếu. Chưa có báo cáo theo ngày hoặc theo người kiểm tra.

## Phương án đề xuất (chờ khách)

- **A. 3 cột:** nội dung = `note`; người nộp/nhận = đối tác (hoặc người ứng tiền với phiếu chi); người kiểm tra = `reviewedBy`. Không migration.
- **B. Đầu ngày / bổ sung quỹ:** tạo phiếu thu "Bổ sung quỹ" (gắn loại rõ ràng, người nhập = kế toán) thay vì sửa `opening_cash`. Số dư đầu ngày = số dư cuối ngày trước, tự tính. Không phụ thuộc việc đã chốt hay chưa.
- **C. Chốt theo ngày:** cho chốt lùi mốc `closeAt` của ngày hôm qua vào sáng hôm sau (hiện đã cho phép mốc quá khứ). Cần thêm hiển thị "ngày chưa chốt" + dùng `reviewedBy`/người chốt làm người kiểm tra.
- **D. Báo cáo:** theo ngày (đầu ngày, thu, chi, cuối ngày, đã chốt chưa, chênh lệch) và theo người kiểm tra (số phiếu, tổng thu/chi đã kiểm theo `reviewedBy`).

## Câu hỏi cần khách trả lời trước khi code

1. "Người kiểm tra" lấy theo người bấm *kiểm tra phiếu* (`reviewedBy`) hay người bấm *chốt quỹ* (`CashClose.createdBy`)? Hai việc có thể khác người.
2. "Số dư đầu ngày" kế toán nhập là số tiền mặt giám đốc đưa (bổ sung quỹ) hay số dư cuối ngày hôm trước? Có cần đối chiếu với số hệ thống tính ra?
3. "Người nộp/nhận" với phiếu chi nhập hàng, chi phí: lấy NCC/đối tác hay người ứng tiền?
4. Báo cáo cần xuất Excel không, và cần xem theo khoảng ngày nào?

## Vòng quỹ mỗi ngày (khách chốt 21/10/2026)

Sáng giám đốc đưa ~10tr (Bổ sung quỹ) → kế toán chi tiêu → giám đốc **lấy hết** tiền về, quỹ = 0; việc này làm **sáng hôm sau** lúc chủ quỹ chốt. Đã làm: loại phiếu chi `NOP_LAI_QUY` (migration `20261022120000_cash_hand_over`); hộp thoại Chốt quỹ có ô "Giám đốc nhận lại toàn bộ" tự lập phiếu nộp lại = số kiểm đếm, ghi vào ngày của mốc chốt (nút "Chốt cho cuối ngày hôm qua"); Bổ sung quỹ + Nộp lại quỹ **không tính** vào Thu/Chi ở dashboard kế toán và cột Tổng thu/chi của báo cáo quỹ; báo cáo có cột "Nộp lại giám đốc" và cảnh báo ngày cuối ngày còn tiền. Test: `tests/cash/report.test.ts`.
