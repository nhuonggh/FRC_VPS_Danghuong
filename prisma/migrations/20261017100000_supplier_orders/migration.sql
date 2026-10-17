-- AlterTable
ALTER TABLE "purchase_lines" ADD COLUMN     "supplierOrderLineId" INTEGER;

-- CreateTable
CREATE TABLE "supplier_orders" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "note" TEXT NOT NULL DEFAULT '',
    "closeReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_order_lines" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "purchasePrice" DECIMAL(18,2) NOT NULL,
    "expectedDate" DATE,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "supplier_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_order_notices" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "purchaseId" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_order_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_orders_code_key" ON "supplier_orders"("code");

-- CreateIndex
CREATE INDEX "supplier_orders_state_date_idx" ON "supplier_orders"("state", "date");

-- CreateIndex
CREATE INDEX "supplier_orders_createdBy_date_idx" ON "supplier_orders"("createdBy", "date");

-- CreateIndex
CREATE INDEX "supplier_orders_partnerId_date_idx" ON "supplier_orders"("partnerId", "date");

-- CreateIndex
CREATE INDEX "supplier_order_lines_orderId_idx" ON "supplier_order_lines"("orderId");

-- CreateIndex
CREATE INDEX "supplier_order_lines_productId_idx" ON "supplier_order_lines"("productId");

-- CreateIndex
CREATE INDEX "supplier_order_notices_userId_readAt_createdAt_idx" ON "supplier_order_notices"("userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_supplierOrderLineId_fkey" FOREIGN KEY ("supplierOrderLineId") REFERENCES "supplier_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_lines" ADD CONSTRAINT "supplier_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "supplier_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_lines" ADD CONSTRAINT "supplier_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_notices" ADD CONSTRAINT "supplier_order_notices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_notices" ADD CONSTRAINT "supplier_order_notices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "supplier_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE INDEX "purchase_lines_supplierOrderLineId_idx" ON "purchase_lines"("supplierOrderLineId");
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_state_check" CHECK (state IN ('DRAFT','SENT','CLOSED','CANCELLED'));
ALTER TABLE "supplier_order_lines" ADD CONSTRAINT "supplier_order_lines_values_check" CHECK (qty > 0 AND factor > 0 AND "purchasePrice" >= 0);
GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_orders", "supplier_order_lines", "supplier_order_notices" TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE "supplier_orders_id_seq", "supplier_order_lines_id_seq", "supplier_order_notices_id_seq" TO app_rw;

ALTER TABLE "supplier_orders" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "supplier_order_lines" ADD COLUMN "processingTypeId" INTEGER REFERENCES "processing_types"("id") ON DELETE RESTRICT;
