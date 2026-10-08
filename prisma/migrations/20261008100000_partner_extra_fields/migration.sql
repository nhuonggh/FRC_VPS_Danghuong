-- Thông tin bổ sung của đối tác (tuỳ chọn): email, TK ngân hàng, người đại diện, thứ tự, loại "Chi phí".
ALTER TABLE "partners" ADD COLUMN "email" TEXT;
ALTER TABLE "partners" ADD COLUMN "bankAccount" TEXT;
ALTER TABLE "partners" ADD COLUMN "representative" TEXT;
ALTER TABLE "partners" ADD COLUMN "sortOrder" INTEGER;
ALTER TABLE "partners" ADD COLUMN "isExpense" BOOLEAN NOT NULL DEFAULT false;
