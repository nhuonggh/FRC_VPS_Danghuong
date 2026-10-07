-- Tỷ lệ m²/md của định mức (bán tôn gia công theo kích thước). Chỉ thêm cột nullable.
ALTER TABLE "boms" ADD COLUMN "areaRatio" DECIMAL(10,4);
ALTER TABLE "boms" ADD CONSTRAINT "boms_areaRatio_positive" CHECK ("areaRatio" IS NULL OR "areaRatio" > 0);
