-- Khách lẻ thân quen: hồ sơ nhẹ (tên + SĐT), không công nợ. Chỉ thêm cột.
ALTER TABLE "partners"
  ADD COLUMN "isRegularRetail" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "phoneKey" TEXT;
CREATE UNIQUE INDEX "partners_phoneKey_key" ON "partners"("phoneKey");
ALTER TABLE "partners" ADD CONSTRAINT "partners_regular_retail_nocredit"
  CHECK ("isRegularRetail" = false OR ("allowCredit" = false AND "debtLimit" = 0));
