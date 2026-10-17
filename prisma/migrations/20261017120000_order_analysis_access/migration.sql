-- Sales-only disclosure permission. Keep purchasing permissions intact.
INSERT INTO "permissions" (code, label, "groupName", "isSensitive")
VALUES ('order.analysis.view', 'Xem định mức, giá vốn và lợi nhuận đơn hàng', 'Bán hàng', true)
ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label, "groupName"=EXCLUDED."groupName", "isSensitive"=true;

-- ASSUMPTION: director and existing role administrators are administrative roles.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT DISTINCT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE p.code='order.analysis.view' AND (r.name='Giám đốc' OR EXISTS (
  SELECT 1 FROM role_permissions rp JOIN permissions a ON a.id=rp."permissionId"
  WHERE rp."roleId"=r.id AND a.code='role.manage'
)) ON CONFLICT DO NOTHING;
