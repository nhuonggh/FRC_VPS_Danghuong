-- Con số giá vốn tham khảo (không chi tiết) cho màn bán hàng của kế toán, kèm cảnh báo bán dưới vốn.
INSERT INTO "permissions" (code, label, "groupName", "isSensitive")
VALUES ('sale.cost_hint.view', 'Xem giá vốn tham khảo khi bán (không chi tiết)', 'Bán hàng', true)
ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label, "groupName"=EXCLUDED."groupName", "isSensitive"=true;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE p.code='sale.cost_hint.view' AND r.name='Kế toán'
ON CONFLICT DO NOTHING;
