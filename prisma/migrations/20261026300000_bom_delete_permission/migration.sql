-- Quyền xóa hẳn định mức NVL: chỉ nhóm "Giám đốc" (nhóm giữ mọi quyền) được cấp mặc định.
INSERT INTO "permissions" (code, label, "groupName", "isSensitive")
VALUES ('bom.delete', 'Xóa hẳn định mức NVL', 'Sản xuất', true)
ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label, "groupName"=EXCLUDED."groupName", "isSensitive"=true;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE p.code='bom.delete' AND r.name='Giám đốc'
ON CONFLICT DO NOTHING;

-- Xóa hẳn định mức (Giám đốc): trigger bất biến D-19 chỉ cho DELETE khi giao dịch tự bật cờ cục bộ
-- `app.bom_delete = on` (service `deleteBoms` bật sau khi đã kiểm quyền + kiểm đơn bán). UPDATE vẫn bị chặn như cũ.
CREATE OR REPLACE FUNCTION bom_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1 FROM "bom_versions" v JOIN "boms" b ON b."id" = v."bomId"
      WHERE v."id" = NEW."bomVersionId" AND b."productId" = NEW."materialProductId"
    ) THEN
      RAISE EXCEPTION 'BOM: nguyên vật liệu không được trùng với chính thành phẩm' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND current_setting('app.bom_delete', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'BOM: dòng định mức bất biến (tạo phiên bản mới thay vì sửa/xoá)' USING ERRCODE = '23514';
END $$;

CREATE OR REPLACE FUNCTION bom_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.bom_delete', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'BOM: không xoá phiên bản (chuyển sang CANCELLED)' USING ERRCODE = '23514';
  END IF;
  IF NEW."bomId" IS DISTINCT FROM OLD."bomId" OR NEW."versionNo" IS DISTINCT FROM OLD."versionNo"
     OR NEW."validFrom" IS DISTINCT FROM OLD."validFrom" OR NEW."note" IS DISTINCT FROM OLD."note"
     OR NEW."createdBy" IS DISTINCT FROM OLD."createdBy" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'BOM: phiên bản bất biến, chỉ được đổi trạng thái' USING ERRCODE = '23514';
  END IF;
  IF NOT (NEW."status" = OLD."status"
          OR (OLD."status" = 'DRAFT' AND NEW."status" IN ('ACTIVE', 'CANCELLED'))
          OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'CANCELLED')) THEN
    RAISE EXCEPTION 'BOM: chuyển trạng thái phiên bản không hợp lệ' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
