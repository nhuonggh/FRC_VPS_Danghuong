-- Kiểu gia công của dòng báo giá (tuỳ chọn). Chỉ thêm cột nullable + FK.
ALTER TABLE "quote_lines" ADD COLUMN "processingTypeId" INTEGER;
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_processingTypeId_fkey" FOREIGN KEY ("processingTypeId") REFERENCES "processing_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "quote_lines_processingTypeId_idx" ON "quote_lines"("processingTypeId");
