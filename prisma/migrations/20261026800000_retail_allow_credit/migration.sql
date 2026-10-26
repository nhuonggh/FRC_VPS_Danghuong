-- Khách lẻ thân quen được ghi nợ (khách quen giao xong hẹn chiều trả). Bỏ CHECK cấm nợ; hạn mức 0 = không giới hạn.
ALTER TABLE "partners" DROP CONSTRAINT "partners_regular_retail_nocredit";
UPDATE "partners" SET "allowCredit" = true WHERE "isRegularRetail" = true;
