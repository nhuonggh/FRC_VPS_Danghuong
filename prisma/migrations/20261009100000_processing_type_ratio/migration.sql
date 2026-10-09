-- Kiểu gia công: tỷ lệ m²/md mặc định, tỷ lệ trừ kho, ĐVT thành cột thật (trước đây chỉ là chữ trong Ghi chú).
ALTER TABLE "processing_types" ADD COLUMN "ratio" DECIMAL(18,4), ADD COLUMN "stockRatio" DECIMAL(18,4), ADD COLUMN "unit" TEXT;

-- Chép số từ Ghi chú dạng "Tỷ lệ 1,08 · Trừ kho 1 · ĐVT m2" (số kiểu VN: phẩy thập phân). Dòng không đọc được giữ nguyên Ghi chú, cột để trống.
UPDATE "processing_types" SET "ratio" = replace((regexp_match("note", 'Tỷ lệ ([0-9]+(?:,[0-9]+)?)'))[1], ',', '.')::numeric WHERE "note" ~ 'Tỷ lệ [0-9]+(,[0-9]+)?( |$|·|\()' ;
UPDATE "processing_types" SET "stockRatio" = replace((regexp_match("note", 'Trừ kho ([0-9]+(?:,[0-9]+)?)'))[1], ',', '.')::numeric WHERE "note" ~ 'Trừ kho [0-9]+(,[0-9]+)?( |$|·)';
UPDATE "processing_types" SET "unit" = (regexp_match("note", 'ĐVT ([^ ·]+)'))[1] WHERE "note" ~ 'ĐVT [^ ·]+';
UPDATE "processing_types" SET "ratio" = NULL WHERE "ratio" <= 0 OR "ratio" > 1000000;
UPDATE "processing_types" SET "stockRatio" = NULL WHERE "stockRatio" <= 0 OR "stockRatio" > 1000000;

-- Bỏ phần đã chép khỏi Ghi chú (chỉ khi cột tương ứng đã có giá trị).
UPDATE "processing_types" SET "note" = NULLIF(btrim(regexp_replace("note", '\s*(—\s*)?Tỷ lệ [0-9]+(,[0-9]+)?( m2| m)?( \(theo sản phẩm đầu tiên dùng kiểu này\))?', ''), E' ·—'), '') WHERE "ratio" IS NOT NULL;
UPDATE "processing_types" SET "note" = NULLIF(btrim(regexp_replace("note", '\s*·?\s*Trừ kho [0-9]+(,[0-9]+)?', ''), E' ·—'), '') WHERE "stockRatio" IS NOT NULL;
UPDATE "processing_types" SET "note" = NULLIF(btrim(regexp_replace("note", '\s*·?\s*ĐVT [^ ·]+', ''), E' ·—'), '') WHERE "unit" IS NOT NULL;

ALTER TABLE "processing_types" ADD CONSTRAINT "processing_types_ratio_positive" CHECK ("ratio" IS NULL OR "ratio" > 0), ADD CONSTRAINT "processing_types_stockRatio_positive" CHECK ("stockRatio" IS NULL OR "stockRatio" > 0);
