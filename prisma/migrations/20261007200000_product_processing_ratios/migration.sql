-- Tỷ lệ m²/md theo (sản phẩm × kiểu gia công), không phụ thuộc định mức. Chuyển dữ liệu từ boms.areaRatio rồi bỏ cột.
CREATE TABLE "product_processing_ratios" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "processingTypeId" INTEGER NOT NULL,
    "ratio" DECIMAL(18,4) NOT NULL,
    "updatedBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_processing_ratios_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_processing_ratios_ratio_positive" CHECK ("ratio" > 0)
);
CREATE UNIQUE INDEX "product_processing_ratios_productId_processingTypeId_key" ON "product_processing_ratios"("productId", "processingTypeId");
ALTER TABLE "product_processing_ratios" ADD CONSTRAINT "product_processing_ratios_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_processing_ratios" ADD CONSTRAINT "product_processing_ratios_processingTypeId_fkey" FOREIGN KEY ("processingTypeId") REFERENCES "processing_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "product_processing_ratios" ("productId", "processingTypeId", "ratio", "updatedBy", "updatedAt")
SELECT "productId", "processingTypeId", "areaRatio", "createdBy", CURRENT_TIMESTAMP FROM "boms" WHERE "areaRatio" IS NOT NULL;

ALTER TABLE "boms" DROP COLUMN "areaRatio";

GRANT SELECT, INSERT, UPDATE, DELETE ON "product_processing_ratios" TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE "product_processing_ratios_id_seq" TO app_rw;
