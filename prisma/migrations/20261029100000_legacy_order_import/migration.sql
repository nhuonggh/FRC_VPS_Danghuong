-- Nhập đơn từ báo cáo phần mềm cũ: mã đơn cũ (chống trùng) + bảng ghi nhớ cách ghép tên. Chỉ thêm, không đổi dữ liệu cũ.
ALTER TABLE "sale_orders" ADD COLUMN "legacyCode" TEXT;
CREATE UNIQUE INDEX "sale_orders_legacyCode_key" ON "sale_orders"("legacyCode");

CREATE TABLE "legacy_aliases" (
  "kind" TEXT NOT NULL,
  "legacyKey" TEXT NOT NULL,
  "targetId" INTEGER NOT NULL,
  "createdBy" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("kind", "legacyKey"),
  CONSTRAINT "legacy_aliases_kind_chk" CHECK ("kind" IN ('PRODUCT', 'PARTNER', 'PROCESSING'))
);
