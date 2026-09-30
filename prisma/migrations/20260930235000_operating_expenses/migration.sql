-- CreateTable
CREATE TABLE "operating_expenses" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "expenseTypeId" INTEGER NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operating_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operating_expenses_paymentId_key" ON "operating_expenses"("paymentId");

-- CreateIndex
CREATE INDEX "operating_expenses_periodId_expenseTypeId_idx" ON "operating_expenses"("periodId", "expenseTypeId");

-- AddForeignKey
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_expenseTypeId_fkey" FOREIGN KEY ("expenseTypeId") REFERENCES "expense_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

