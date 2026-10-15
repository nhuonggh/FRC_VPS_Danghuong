-- Plan 06-E1: lệnh sản xuất phụ kiện
CREATE TABLE "production_orders" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "outSeq" BIGINT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "production_materials" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "materialProductId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "seq" BIGINT,
    CONSTRAINT "production_materials_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "production_orders_code_key" ON "production_orders"("code");
-- CreateIndex
CREATE INDEX "production_orders_periodId_at_idx" ON "production_orders"("periodId", "at");
-- CreateIndex
CREATE UNIQUE INDEX "production_materials_orderId_materialProductId_key" ON "production_materials"("orderId", "materialProductId");
-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "production_materials" ADD CONSTRAINT "production_materials_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "production_materials" ADD CONSTRAINT "production_materials_materialProductId_fkey" FOREIGN KEY ("materialProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Số liệu hợp lệ
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_qty_chk" CHECK ("qty" > 0);
ALTER TABLE "production_materials" ADD CONSTRAINT "production_materials_qty_chk" CHECK ("qty" > 0);
