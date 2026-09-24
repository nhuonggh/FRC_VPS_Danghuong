# Dữ liệu nhạy cảm: quy ước ẩn field và nhật ký

## Ẩn field theo quyền (T2)
- Mọi hàm trả DTO ra client kết thúc bằng `redactDeep(dto, actor.perms)` (`src/lib/permissions/redact.ts`).
- Redact chạy theo **tên field** (bảng `SENSITIVE_FIELDS` trong `src/lib/permissions/catalog.ts`), xuyên object lồng nhau và mảng (dòng hàng).
- **Không bao giờ trả giá trị nhạy cảm dưới tên chung chung** (`price`, `unitPrice`, `amount`, `total`...): redact không thể phân biệt giá bán, giá nhập hay giá vốn theo tên đó. Dùng tên riêng (`salePrice`, `purchasePrice`, `unitCostFifo`, `lineProfit`, `margin`...) và đăng ký vào `SENSITIVE_FIELDS`.
- Mỗi quyền `*.view` nhạy cảm (`cost.view`, `profit.view`, `purchase_price.view`, `sale_price.view`) phải có ít nhất 1 field trong bảng (có test canh).
- Module thêm field nhạy cảm mới: thêm dòng vào `SENSITIVE_FIELDS` + test ở module đó.

## Nhật ký thao tác (audit_log)
- Chỉ ghi qua `writeAudit`. Bảng append-only ở DB: thứ gì đã ghi thì không xoá được.
- `writeAudit` tự bỏ các khoá bí mật ở mọi tầng của `before`/`after` (`AUDIT_SECRET_KEYS`: passwordHash, password, tempPassword, token, secret... và hậu tố `*token`/`*secret`/`*password`, không phân biệt hoa/thường). Vẫn nên truyền DTO đã chọn field, không truyền nguyên dòng DB.
- `before`/`after` có thể chứa giá vốn/lãi/giá nhập/giá bán. **Đường đọc audit (GĐ0b, quyền `audit.view`) phải áp `redactDeep` lên `beforeJson`/`afterJson`** trước khi trả ra client.
- **Đã thực hiện (Task 13, mã 5):** đường đọc là `toAuditDetail(row, by, actor.perms)` (`src/server/audit/queries.ts`) — `redactDeep` với quyền của NGƯỜI XEM → `diffJson` → định dạng; client chỉ nhận danh sách (trường, số cũ, số mới) đã lọc, KHÔNG nhận JSON thô. Bảng danh sách không đọc `beforeJson/afterJson/ip`. Xuất Excel (`src/server/audit/export.ts`) áp cùng `redactDeep`. Cờ `hiddenByPermission` báo cho người xem biết có field bị ẩn (không nhầm với "không ghi số liệu").
