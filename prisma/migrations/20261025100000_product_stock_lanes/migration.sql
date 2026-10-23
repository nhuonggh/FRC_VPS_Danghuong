CREATE TABLE "product_stock_lanes" (
  "productId" INTEGER NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "processingTypeId" INTEGER NOT NULL REFERENCES "processing_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "stockProductId" INTEGER NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("productId", "processingTypeId")
);
CREATE INDEX "product_stock_lanes_stockProductId_idx" ON "product_stock_lanes"("stockProductId");
