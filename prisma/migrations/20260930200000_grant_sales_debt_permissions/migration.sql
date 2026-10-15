-- Cấp MỘT LẦN các quyền của plan 04 cho vai trò mẫu đã tồn tại (chỉ THÊM, không gỡ; vai trò/quyền chưa có thì bỏ qua).
-- Seed chỉ gán quyền mặc định cho vai trò MỚI tạo nên vai trò cũ (Bán hàng, Kế toán) không tự nhận quyền mới.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
JOIN "permissions" p ON
  (r.name = 'Bán hàng' AND p.code IN ('order.edit_price', 'quote.manage', 'deposit.manage', 'return.manage'))
  OR (r.name = 'Kế toán' AND p.code IN ('order.edit_price', 'order.delete_draft', 'quote.manage', 'deposit.manage', 'return.manage', 'debt.view', 'debt.adjust'))
  OR (r.name = 'Thủ quỹ' AND p.code IN ('debt.view'))
ON CONFLICT DO NOTHING;
