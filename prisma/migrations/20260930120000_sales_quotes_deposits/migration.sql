-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('DRAFT', 'SENT', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "receipt_type" AS ENUM ('THU_NO', 'COC', 'KHAC');

-- AlterTable
ALTER TABLE "sale_orders" ADD COLUMN     "isDraft" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "quotes" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "status" "quote_status" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "convertedOrderId" INTEGER,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" SERIAL NOT NULL,
    "quoteId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "salePrice" DECIMAL(18,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "type" "receipt_type" NOT NULL,
    "orderId" INTEGER,
    "amount" DECIMAL(18,2) NOT NULL,
    "cashAccountId" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotes_code_key" ON "quotes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_convertedOrderId_key" ON "quotes"("convertedOrderId");

-- CreateIndex
CREATE INDEX "quotes_periodId_at_idx" ON "quotes"("periodId", "at");

-- CreateIndex
CREATE INDEX "quotes_partnerId_idx" ON "quotes"("partnerId");

-- CreateIndex
CREATE INDEX "quote_lines_quoteId_idx" ON "quote_lines"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_code_key" ON "receipts"("code");

-- CreateIndex
CREATE INDEX "receipts_orderId_idx" ON "receipts"("orderId");

-- CreateIndex
CREATE INDEX "receipts_periodId_at_idx" ON "receipts"("periodId", "at");

-- CreateIndex
CREATE INDEX "receipts_partnerId_idx" ON "receipts"("partnerId");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_convertedOrderId_fkey" FOREIGN KEY ("convertedOrderId") REFERENCES "sale_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Ràng buộc DB (plan 04 Task C5) =====
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_values_chk" CHECK ("qty" > 0 AND "salePrice" >= 0);
-- Tiền thu phải dương; phiếu COC/THU_NO vào quỹ nên luôn có tài khoản (cashAccountId NOT NULL)
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_amount_chk" CHECK ("amount" > 0);
-- Báo giá đã chuyển thành đơn phải trỏ tới đơn và ngược lại
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_converted_chk" CHECK (("status" = 'CONVERTED') = ("convertedOrderId" IS NOT NULL));
