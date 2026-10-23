-- Migration 20261020120000 chỉ cấp sale.cost_hint.view cho "Kế toán" mà quên "Giám đốc" (nhóm giữ mọi quyền).
-- Hệ quả: Giám đốc không cấp lại mật khẩu/khoá/đổi nhóm được tài khoản Kế toán (chống leo thang đặc quyền: quyền đối tượng ⊄ quyền mình).
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE p.code='sale.cost_hint.view' AND r.name='Giám đốc'
ON CONFLICT DO NOTHING;
