-- CreateEnum
CREATE TYPE "recompute_status" AS ENUM ('PENDING', 'RUNNING', 'FAILED');

-- CreateTable
CREATE TABLE "recompute_jobs" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "status" "recompute_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recompute_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recompute_jobs_productId_key" ON "recompute_jobs"("productId");

-- CreateIndex
CREATE INDEX "recompute_jobs_status_id_idx" ON "recompute_jobs"("status", "id");

-- CreateIndex
CREATE INDEX "stock_ledger_periodId_productId_qtyProvisional_idx" ON "stock_ledger"("periodId", "productId", "qtyProvisional");
