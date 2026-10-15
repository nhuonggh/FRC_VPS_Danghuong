-- Kiểu gia công của dòng phiếu nhập (tuỳ chọn, chỉ ghi nhận). Chỉ thêm cột nullable + FK.
ALTER TABLE "purchase_lines" ADD COLUMN "processingTypeId" INTEGER;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_processingTypeId_fkey" FOREIGN KEY ("processingTypeId") REFERENCES "processing_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "purchase_lines_processingTypeId_idx" ON "purchase_lines"("processingTypeId");
