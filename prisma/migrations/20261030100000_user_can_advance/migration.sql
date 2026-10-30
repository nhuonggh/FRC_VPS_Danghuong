-- Cờ "được ứng tiền chi phí" trên tài khoản; thay danh sách lái xe + phụ xe (bị trùng tên) ở ô Người ứng tiền.
ALTER TABLE "users" ADD COLUMN "canAdvance" BOOLEAN NOT NULL DEFAULT false;

-- Bật sẵn cho 17 người khách đã liệt kê (khớp đúng họ tên, không phân biệt hoa/thường). Ai chưa có tài khoản thì bật tay ở trang người dùng.
UPDATE "users" SET "canAdvance" = true
WHERE "isLocked" = false AND lower(btrim("fullName")) IN (
  'chức', 'cún', 'đạt', 'giáp', 'hạnh', 'hùng', 'huỳnh', 'sáng', 'nghĩa', 'thắng', 'tuấn', 'vịnh', 'xuân', 'phượng', 'nhâm', 'yến', 'lan'
);
