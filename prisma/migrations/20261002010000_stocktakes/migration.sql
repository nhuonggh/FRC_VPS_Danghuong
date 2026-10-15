-- Plan 06-E4: kiểm kho
-- CreateEnum
CREATE TYPE "stocktake_status" AS ENUM ('DRAFT', 'DONE', 'CANCELLED');
-- CreateTable
CREATE TABLE "stocktakes" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "status" "stocktake_status" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stocktakes_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "stocktake_lines" (
    "id" SERIAL NOT NULL,
    "stocktakeId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "actualQty" DECIMAL(18,3) NOT NULL,
    "systemQty" DECIMAL(18,3),
    "diff" DECIMAL(18,3),
    "unitCost" DECIMAL(18,4),
    "seq" BIGINT,
    CONSTRAINT "stocktake_lines_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "stocktakes_code_key" ON "stocktakes"("code");
-- CreateIndex
CREATE INDEX "stocktakes_periodId_at_idx" ON "stocktakes"("periodId", "at");
-- CreateIndex
CREATE INDEX "stocktakes_periodId_status_idx" ON "stocktakes"("periodId", "status");
-- CreateIndex
CREATE UNIQUE INDEX "stocktake_lines_stocktakeId_productId_key" ON "stocktake_lines"("stocktakeId", "productId");
-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "stocktakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_actual_chk" CHECK ("actualQty" >= 0);
-- Đã chốt (DONE) thì phải có đủ số liệu chốt; chưa chốt thì chưa có
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_confirm_chk" CHECK (("status" = 'DONE') = ("confirmedAt" IS NOT NULL) OR "status" = 'CANCELLED');
