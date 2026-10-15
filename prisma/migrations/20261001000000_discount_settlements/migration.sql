-- CreateTable
CREATE TABLE "discount_settlements" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "method" "discount_settle_method" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "paymentId" INTEGER,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_settlements_code_key" ON "discount_settlements"("code");

-- CreateIndex
CREATE UNIQUE INDEX "discount_settlements_paymentId_key" ON "discount_settlements"("paymentId");

-- CreateIndex
CREATE INDEX "discount_settlements_periodId_at_idx" ON "discount_settlements"("periodId", "at");

-- CreateIndex
CREATE INDEX "discount_settlements_partnerId_idx" ON "discount_settlements"("partnerId");

-- AddForeignKey
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECK số liệu/trạng thái: tiền mặt ⇔ có phiếu chi; trừ nợ ⇔ không có phiếu chi
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_method_chk" CHECK (("method" = 'CASH' AND "paymentId" IS NOT NULL) OR ("method" = 'OFFSET' AND "paymentId" IS NULL));
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_cancel_chk" CHECK (("isCancelled" AND "cancelledAt" IS NOT NULL) OR (NOT "isCancelled" AND "cancelledAt" IS NULL));
