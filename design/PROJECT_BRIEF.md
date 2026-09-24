# PROJECT_BRIEF — Phần mềm quản lý Xưởng tôn Đặng Hương

## 1. Tổng quan
- Loại: ERP nghiệp vụ (đơn hàng – kho FIFO – giao hàng – kế toán – sản xuất/gia công – kết sổ kỳ)
- Người dùng: Giám đốc, Kế toán, Thủ kho, Thủ quỹ (2 người), Bán hàng
- Stack: Next.js 15 + Tailwind 3.4 (token) + Radix + TanStack Query
- Locale: vi-VN; tiền ₫ (VND); ngày dd/mm/yyyy; nghìn "."; thập phân ","; múi giờ Asia/Ho_Chi_Minh
- Thiết bị: 100% máy tính (D-5): cơ chế mobile có sẵn ở component chung, không nghiệm thu từng màn

## 2. Thương hiệu → design/app-override.css
- Accent: mặc định skill (#2563eb) — ASSUMPTION / TODO: CHƯA có màu thương hiệu của Xưởng Đặng Hương, khi có thì chỉ đổi --accent-500/--accent-600 trong design/app-override.css; Font: Be Vietnam Pro; Semantic: mặc định
- Dark mode: Sáng/Tối/Hệ thống, mặc định Hệ thống

## 3. Schema → db/db_schema.sql (sinh bằng npm run db:schema)

## 4. Điều hướng → src/config/app.config.ts (1 nguồn; đã liệt kê đủ 81 màn theo mã phạm vi)
Tất cả module dùng Accordion (≥ 3 chức năng), riêng Trang chủ là Flat. Thứ tự theo luồng nghiệp vụ.

## 5. View mỗi chức năng
| Chức năng | View chính | Ghi chú |
|---|---|---|
| Mọi danh sách chứng từ (đơn, phiếu nhập/thu/chi, chuyến, trả hàng…) | Table server-paginated + Stat Card trạng thái + QuickTimeFilter | Mở chi tiết = Full-page Detail `/{module}/{id}?tab=`; tạo mới `/{module}/new` |
| Đơn hàng | Table (+ Kanban theo trục giao hàng khi cần) | 2 trục trạng thái: badge riêng, không gộp |
| Tồn kho, KH, NCC, SP | Table | Import Excel (D-6) |
| Cài đặt danh mục (8,13–18) | Catalog Settings | CATALOG_SECTIONS: nhóm KH, kho, xe & lái xe, tuyến, loại thu chi, ngân hàng/quỹ, kiểu gia công |
| Sổ kho, sổ quỹ, sổ NH, công nợ chi tiết | Table (không có chi tiết từng dòng) | Số dư TÍNH KHI ĐỌC, không cột lưu sẵn |
| XNT, báo cáo 67–73 | Pivot/Report | Ẩn cột giá vốn/lãi theo quyền ở SERVER |
| Trang chủ (7) | Dashboard số liệu trong ngày | GĐ1b-B7 |
| Kết sổ K5 | Form + checklist (mục đỏ khóa nút) | Chỉ Giám đốc |

## 6. Chi tiết bản ghi — tab & Action Bar
| Đối tượng | Tab (key) | Action (chỉ hiện khi) | Quyền |
|---|---|---|---|
| Đơn hàng | info · lines · delivery · payments · history | In hóa đơn/phiếu giao; Sửa (kỳ mở); Hủy (chưa dính tiền); Khôi phục (đã hủy, kỳ mở) | order.edit / order.cancel / order.restore |
| Khách hàng | info · orders · debt · discount · history | Gọi; Sửa; Gộp mã | partner.manage |
| Phiếu nhập | info · lines · freight · history | In; Sửa (kỳ mở); Hủy | purchase.edit / purchase.cancel |
| Chuyến giao | info · orders · settlement | In phiếu giao; Nhập kết quả; Đối soát; Xác nhận nhận tiền (thủ quỹ) | trip.manage / trip.settle / trip.confirm_cash |
| Người dùng | info · roles · history | Khóa/Mở khóa; Cấp lại mật khẩu | user.manage |

## 7. Workflow
- Giao hàng: Mới tạo → Chờ hàng → Sẵn hàng → Đã xếp xe → Đang giao → Đã giao / Giao một phần / Không giao được
- Thanh toán (trục độc lập): Chưa thu → Đã cọc → Thu một phần → Đã thanh toán → Nợ ghi sổ → Hẹn đơn sau trả → Dư tiền
- Chuyến: PLANNED → ON_ROAD → RETURNED → SETTLED → CONFIRMED (chênh lệch ≠ 0 bắt buộc lý do)
- Không có Kanban kéo-thả thay đổi trạng thái tiền/kho (chuyển trạng thái đi qua nghiệp vụ có transaction)

## 8. Phân quyền hiển thị
- Menu/action: ẩn HẲN khi thiếu quyền. Field nhạy cảm (giá vốn, lãi, giá nhập, giá bán): loại khỏi DTO ở server (redactDeep), UI không render cột.
- "Chỉ khách của mình": phạm vi dữ liệu ở query (partnerScopeWhere), không phải ẩn UI.

## 9. Ngoài phạm vi
Hóa đơn VAT, app điện thoại lái xe, nhiều chi nhánh/chuyển kho, tồn theo cuộn, nối ngân hàng tự động, Zalo/SMS, chấm công/lương, notification center (không có mã trong Phạm vi → không làm).
