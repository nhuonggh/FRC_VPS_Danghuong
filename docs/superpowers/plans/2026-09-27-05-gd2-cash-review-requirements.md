# Bổ sung phạm vi Plan 05 — Quỹ tiền mặt chung hậu kiểm

> Trạng thái: **đã duyệt bổ sung phạm vi 27/09/2026; chưa triển khai**. Đây là yêu cầu nghiệp vụ khóa cho plan kỹ thuật GĐ2, không thay thế plan chi tiết sẽ viết sau Plan 04.

## Mục tiêu vận hành

- Một quỹ tiền mặt chung; ba kế toán đều được lập phiếu thu/chi và ghi nhận ngay khi phát sinh.
- Thủ quỹ hậu kiểm tập trung khi có mặt; giao dịch chưa kiểm tra không chặn bán hàng hoặc công nợ ngày sau.
- Mọi số liệu và hành động phải truy ra người thực hiện, thời điểm, lý do và lịch sử audit.

## Luồng chứng từ tiền

```text
Kế toán lập/gửi phiếu → PENDING_REVIEW
                         ├─ Thủ quỹ kiểm tra → REVIEWED (khóa sửa/xóa trực tiếp)
                         └─ Thủ quỹ trả lại → RETURNED → Kế toán sửa/gửi lại → PENDING_REVIEW

REVIEWED → yêu cầu điều chỉnh (lý do bắt buộc) → thủ quỹ duyệt/thực hiện điều chỉnh → audit đầy đủ
```

- Phiếu phải có: loại `RECEIPT|PAYMENT`, nội dung, số tiền Decimal, quỹ, thời điểm chứng từ, người lập, thời điểm lập, trạng thái, lịch sử trả lại/duyệt.
- Thay đổi tiền không được xóa dấu vết. Điều chỉnh phải liên kết chứng từ gốc và tạo dòng sổ đảo/điều chỉnh; không sửa trực tiếp dòng `cash_ledger` đã được kiểm tra.
- Ghi tiền, công nợ liên quan, trạng thái và audit phải ở cùng transaction; mọi lệnh tạo/duyệt có idempotency key.

## Công nợ và báo cáo

- `partner_ledger` cập nhật ngay khi phát sinh giao dịch tiền/bán hàng; không phụ thuộc việc thủ quỹ đã kiểm tra.
- Màn công nợ hiển thị ba chỉ số: **công nợ vận hành hiện tại**, **phát sinh/giá trị đã kiểm tra**, **phát sinh/giá trị chờ kiểm tra**.
- Sổ quỹ cũng phải phân biệt số liệu vận hành gồm phiếu chờ kiểm tra với số liệu đã kiểm tra; không dùng trạng thái hậu kiểm để khóa giao dịch bán hàng sau đó.

## Danh sách chờ kiểm tra

Một work queue riêng cho: đơn hàng, thu tiền, chi tiền, cộng/trừ công nợ, chiết khấu và điều chỉnh khác. Bộ lọc: ngày, người thực hiện, loại giao dịch, khách hàng, trạng thái. Các thao tác `review`/`return` phải chống thao tác đồng thời và ghi audit.

## Chốt quỹ

- Thủ quỹ chọn mốc chốt; ứng dụng tính `tồn đầu + tổng thu - tổng chi` và nhận tiền kiểm đếm thực tế.
- Lưu: người chốt, thời gian, số dư theo ứng dụng, tiền thực tế, chênh lệch và mốc dữ liệu chốt.
- Chốt quỹ là snapshot/hậu kiểm quỹ, **không** thay thế `period.close` và không tự khóa mọi chứng từ của kỳ.

## Phân quyền mục tiêu

| Quyền mới | Kế toán | Thủ quỹ | Giám đốc |
|---|---:|---:|---:|
| `cash.transaction.create` / `cash.transaction.edit_pending` | Có | Tùy cấu hình | Có |
| `cash.review` (kiểm tra/trả lại) | Không | Có | Có |
| `cash.adjust.request` | Có | Có | Có |
| `cash.adjust.approve` | Không | Có | Có |
| `cash.close` | Không | Có | Có |
| `cash.close.reopen` | Không | Không | Có/cấp riêng |
| `cashbook.view`, `debt.view` | Có | Có | Có |

Các quyền `receipt.manage` và `payment.manage` hiện tại sẽ được tách tương thích khi triển khai để không làm vỡ vai trò cũ.

## Cần xác nhận trước khi viết plan kỹ thuật

1. `RETURNED`: sửa phiếu gốc rồi gửi lại, hay bắt buộc sinh phiên bản điều chỉnh mới?
2. Chốt quỹ theo ngày, theo ca, hay người chốt tự chọn mốc?
3. Có chênh lệch thì cho chốt kèm lý do, hay bắt buộc xử lý hết mới chốt?
4. Sau `REVIEWED`, thủ quỹ được sửa trực tiếp hay chỉ lập/duyệt phiếu điều chỉnh?

## Điều kiện triển khai

- Chờ user cung cấp kết quả deploy các commit Task 4–5.
- Không triển khai trước Plan 04, vì D1 cần nguồn phát sinh công nợ/bán hàng và hợp đồng `partner_ledger` của Plan 04.
