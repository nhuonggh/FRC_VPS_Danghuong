-- Danh mục đơn vị tính (nạp sẵn từ đơn vị đang dùng) + giá/đơn vị/thông tin bổ sung của sản phẩm. Chỉ thêm bảng/cột nullable.
CREATE TABLE "units" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "units_name_key" ON "units"("name");

INSERT INTO "units" ("name")
SELECT DISTINCT TRIM(u) FROM (
    SELECT "baseUnit" AS u FROM "products"
    UNION SELECT "unit" FROM "product_units"
) x WHERE TRIM(u) <> ''
ON CONFLICT DO NOTHING;

ALTER TABLE "products"
    ADD COLUMN "purchasePrice" DECIMAL(18,2),
    ADD COLUMN "salePrice" DECIMAL(18,2),
    ADD COLUMN "importUnit" TEXT,
    ADD COLUMN "exportUnit" TEXT,
    ADD COLUMN "bundleQty" DECIMAL(18,3),
    ADD COLUMN "qtyLabel" TEXT,
    ADD CONSTRAINT "products_prices_nonneg" CHECK (("purchasePrice" IS NULL OR "purchasePrice" >= 0) AND ("salePrice" IS NULL OR "salePrice" >= 0) AND ("bundleQty" IS NULL OR "bundleQty" > 0));

GRANT SELECT, INSERT, UPDATE, DELETE ON "units" TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE "units_id_seq" TO app_rw;
