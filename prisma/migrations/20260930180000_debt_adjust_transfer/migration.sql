-- CreateEnum
CREATE TYPE "debt_adjust_reason" AS ENUM ('HANG_LOI', 'BEP_MOP', 'CHIET_KHAU', 'KHAC');

-- CreateEnum
CREATE TYPE "debt_transfer_kind" AS ENUM ('TRANSFER', 'MERGE');

-- CreateTable
CREATE TABLE "debt_adjustments" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "reason" "debt_adjust_reason" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_transfers" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "debt_transfer_kind" NOT NULL,
    "fromPartnerId" INTEGER NOT NULL,
    "toPartnerId" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "discountMoved" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "debt_adjustments_code_key" ON "debt_adjustments"("code");

-- CreateIndex
CREATE INDEX "debt_adjustments_periodId_at_idx" ON "debt_adjustments"("periodId", "at");

-- CreateIndex
CREATE INDEX "debt_adjustments_partnerId_idx" ON "debt_adjustments"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "debt_transfers_code_key" ON "debt_transfers"("code");

-- CreateIndex
CREATE INDEX "debt_transfers_periodId_at_idx" ON "debt_transfers"("periodId", "at");

-- CreateIndex
CREATE INDEX "debt_transfers_fromPartnerId_idx" ON "debt_transfers"("fromPartnerId");

-- CreateIndex
CREATE INDEX "debt_transfers_toPartnerId_idx" ON "debt_transfers"("toPartnerId");

-- AddForeignKey
ALTER TABLE "debt_adjustments" ADD CONSTRAINT "debt_adjustments_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_adjustments" ADD CONSTRAINT "debt_adjustments_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_transfers" ADD CONSTRAINT "debt_transfers_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_transfers" ADD CONSTRAINT "debt_transfers_fromPartnerId_fkey" FOREIGN KEY ("fromPartnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_transfers" ADD CONSTRAINT "debt_transfers_toPartnerId_fkey" FOREIGN KEY ("toPartnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECK: điều chỉnh khác 0; chuyển khác đối tác, khác 0 trừ khi gộp; chiết khấu chuyển kèm chỉ khi gộp
ALTER TABLE "debt_adjustments" ADD CONSTRAINT "debt_adjustments_amount_chk" CHECK ("amount" <> 0);
ALTER TABLE "debt_transfers" ADD CONSTRAINT "debt_transfers_partners_chk" CHECK ("fromPartnerId" <> "toPartnerId");
ALTER TABLE "debt_transfers" ADD CONSTRAINT "debt_transfers_amount_chk" CHECK ("kind" = 'MERGE' OR "amount" <> 0);
ALTER TABLE "debt_transfers" ADD CONSTRAINT "debt_transfers_discount_chk" CHECK ("discountMoved" >= 0 AND ("kind" = 'MERGE' OR "discountMoved" = 0));
