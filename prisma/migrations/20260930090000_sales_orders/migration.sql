-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('NEW', 'WAITING_STOCK', 'READY', 'LOADED', 'DELIVERING', 'DELIVERED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('UNPAID', 'DEPOSITED', 'PARTIAL', 'PAID', 'DEBT', 'PROMISED', 'OVERPAID');

-- CreateTable
CREATE TABLE "sale_orders" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "deliveryStatus" "delivery_status" NOT NULL DEFAULT 'NEW',
    "paymentStatus" "payment_status" NOT NULL DEFAULT 'UNPAID',
    "orderDate" TIMESTAMP(3) NOT NULL,
    "expectedDeliveryDate" DATE NOT NULL,
    "originalDeliveryDate" DATE NOT NULL,
    "note" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_order_lines" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "factorUsed" DECIMAL(18,6) NOT NULL,
    "qtyBase" DECIMAL(18,3) NOT NULL,
    "salePrice" DECIMAL(18,2) NOT NULL,
    "discountNow" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountAccum" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitCostFifo" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "processingTypeId" INTEGER,
    "bomVersionId" INTEGER,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_line_issues" (
    "id" SERIAL NOT NULL,
    "orderLineId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qtyBase" DECIMAL(18,3) NOT NULL,
    "seq" BIGINT,

    CONSTRAINT "sale_line_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_notes" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_lines" (
    "id" SERIAL NOT NULL,
    "deliveryNoteId" INTEGER NOT NULL,
    "orderLineId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "delivery_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sale_orders_code_key" ON "sale_orders"("code");

-- CreateIndex
CREATE INDEX "sale_orders_periodId_orderDate_idx" ON "sale_orders"("periodId", "orderDate");

-- CreateIndex
CREATE INDEX "sale_orders_partnerId_orderDate_idx" ON "sale_orders"("partnerId", "orderDate");

-- CreateIndex
CREATE INDEX "sale_orders_expectedDeliveryDate_idx" ON "sale_orders"("expectedDeliveryDate");

-- CreateIndex
CREATE INDEX "sale_order_lines_orderId_idx" ON "sale_order_lines"("orderId");

-- CreateIndex
CREATE INDEX "sale_order_lines_productId_idx" ON "sale_order_lines"("productId");

-- CreateIndex
CREATE INDEX "sale_line_issues_productId_idx" ON "sale_line_issues"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_line_issues_orderLineId_productId_key" ON "sale_line_issues"("orderLineId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_notes_code_key" ON "delivery_notes"("code");

-- CreateIndex
CREATE INDEX "delivery_notes_orderId_idx" ON "delivery_notes"("orderId");

-- CreateIndex
CREATE INDEX "delivery_notes_periodId_at_idx" ON "delivery_notes"("periodId", "at");

-- CreateIndex
CREATE INDEX "delivery_lines_deliveryNoteId_idx" ON "delivery_lines"("deliveryNoteId");

-- CreateIndex
CREATE INDEX "delivery_lines_orderLineId_idx" ON "delivery_lines"("orderLineId");

-- CreateIndex
CREATE INDEX "discount_ledger_orderLineId_idx" ON "discount_ledger"("orderLineId");

-- AddForeignKey
ALTER TABLE "discount_ledger" ADD CONSTRAINT "discount_ledger_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sale_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_processingTypeId_fkey" FOREIGN KEY ("processingTypeId") REFERENCES "processing_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_bomVersionId_fkey" FOREIGN KEY ("bomVersionId") REFERENCES "bom_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_issues" ADD CONSTRAINT "sale_line_issues_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "sale_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_issues" ADD CONSTRAINT "sale_line_issues_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Ràng buộc DB (plan 04 Task C1) =====
-- Lớp chặn cuối cho import/script: số lượng, giá, chiết khấu không âm; tổng chiết khấu không vượt giá trị dòng.
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_values_chk" CHECK (
  "qty" > 0 AND "factorUsed" > 0 AND "qtyBase" > 0 AND "salePrice" >= 0
  AND "discountNow" >= 0 AND "discountAccum" >= 0 AND "unitCostFifo" >= 0
  AND "discountNow" + "discountAccum" <= "qty" * "salePrice"
);
ALTER TABLE "sale_line_issues" ADD CONSTRAINT "sale_line_issues_qty_chk" CHECK ("qtyBase" > 0);
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_qty_chk" CHECK ("qty" > 0);
-- Ngày giao dự kiến chỉ được dời về phía sau; original giữ nguyên để tính số ngày trễ.
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_expected_chk" CHECK ("expectedDeliveryDate" >= "originalDeliveryDate");
