CREATE TABLE "reference_cost_plans" (
  "id" SERIAL PRIMARY KEY,
  "productId" INTEGER REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "processingTypeId" INTEGER NOT NULL REFERENCES "processing_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "validFrom" DATE NOT NULL,
  "tonProductId" INTEGER REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "fixedPricePerM2" DECIMAL(18,4),
  "tonQtyPerMeter" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "feePerMeter" DECIMAL(18,4),
  "note" TEXT,
  "createdBy" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reference_cost_amounts_check" CHECK (
    ("fixedPricePerM2" IS NULL OR "fixedPricePerM2" >= 0) AND
    ("feePerMeter" IS NULL OR "feePerMeter" >= 0) AND "tonQtyPerMeter" > 0),
  CONSTRAINT "reference_cost_scope_check" CHECK (
    ("productId" IS NULL AND "tonProductId" IS NULL AND "fixedPricePerM2" IS NULL AND "feePerMeter" IS NOT NULL) OR
    ("productId" IS NOT NULL AND "tonProductId" IS NOT NULL))
);
CREATE UNIQUE INDEX "reference_cost_plans_productId_processingTypeId_validFrom_key"
 ON "reference_cost_plans"("productId", "processingTypeId", "validFrom");
CREATE UNIQUE INDEX "reference_cost_default_date_key" ON "reference_cost_plans"("processingTypeId", "validFrom") WHERE "productId" IS NULL;
CREATE INDEX "reference_cost_plans_processingTypeId_validFrom_idx" ON "reference_cost_plans"("processingTypeId", "validFrom");
ALTER TABLE "sale_order_lines" ADD COLUMN "referenceCostSnapshot" JSONB;
