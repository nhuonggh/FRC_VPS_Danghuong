-- Người ứng tiền có thể là lái xe/phụ xe (không có tài khoản đăng nhập)
ALTER TABLE "payments" ADD COLUMN "advancedByDriverId" INTEGER;
ALTER TABLE "payments" ADD CONSTRAINT "payments_advancedByDriverId_fkey"
  FOREIGN KEY ("advancedByDriverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_advanced_one_chk"
  CHECK ("advancedById" IS NULL OR "advancedByDriverId" IS NULL);

-- Chi phí lái xe ứng từ tiền thu của chuyến giao
CREATE TABLE "trip_expenses" (
  "id" SERIAL NOT NULL,
  "tripId" INTEGER NOT NULL,
  "expenseTypeId" INTEGER NOT NULL,
  "cashAccountId" INTEGER NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "note" TEXT,
  "paymentId" INTEGER,
  "createdBy" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trip_expenses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trip_expenses_amount_chk" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "trip_expenses_paymentId_key" ON "trip_expenses"("paymentId");
CREATE INDEX "trip_expenses_tripId_idx" ON "trip_expenses"("tripId");
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_expenseTypeId_fkey" FOREIGN KEY ("expenseTypeId") REFERENCES "expense_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
