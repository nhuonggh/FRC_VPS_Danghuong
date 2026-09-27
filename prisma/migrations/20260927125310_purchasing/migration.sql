-- CreateEnum
CREATE TYPE "stock_adjustment_type" AS ENUM ('IN_NO_SUPPLIER', 'LOSS', 'WRITE_OFF', 'STOCKTAKE');

-- CreateTable
CREATE TABLE "purchases" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "freightCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "purchaseTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" SERIAL NOT NULL,
    "purchaseId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "factorUsed" DECIMAL(18,6) NOT NULL,
    "qtyBase" DECIMAL(18,3) NOT NULL,
    "purchasePrice" DECIMAL(18,2) NOT NULL,
    "purchaseAmount" DECIMAL(18,2) NOT NULL,
    "allocatedFreight" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rollInfo" TEXT,
    "rollSearch" TEXT NOT NULL DEFAULT '',
    "seq" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "type" "stock_adjustment_type" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_lines" (
    "id" SERIAL NOT NULL,
    "adjustmentId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "seq" BIGINT,

    CONSTRAINT "stock_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchases_code_key" ON "purchases"("code");

-- CreateIndex
CREATE INDEX "purchases_periodId_at_idx" ON "purchases"("periodId", "at");

-- CreateIndex
CREATE INDEX "purchases_partnerId_at_idx" ON "purchases"("partnerId", "at");

-- CreateIndex
CREATE INDEX "purchase_lines_purchaseId_idx" ON "purchase_lines"("purchaseId");

-- CreateIndex
CREATE INDEX "purchase_lines_productId_idx" ON "purchase_lines"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_code_key" ON "stock_adjustments"("code");

-- CreateIndex
CREATE INDEX "stock_adjustments_periodId_at_idx" ON "stock_adjustments"("periodId", "at");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_adjustmentId_idx" ON "stock_adjustment_lines"("adjustmentId");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_productId_idx" ON "stock_adjustment_lines"("productId");

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "stock_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lớp chặn DB cho dữ liệu phiếu nhập: cả import/script cũng không ghi được số âm/0 sai quy ước.
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_amounts_nonneg_chk"
  CHECK ("freightCost" >= 0 AND "purchaseTotal" >= 0);
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_values_chk"
  CHECK ("qty" > 0 AND "factorUsed" > 0 AND "qtyBase" > 0 AND "purchasePrice" >= 0 AND "purchaseAmount" >= 0 AND "allocatedFreight" >= 0);
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_values_chk"
  CHECK ("qty" > 0 AND "unitCost" >= 0);
