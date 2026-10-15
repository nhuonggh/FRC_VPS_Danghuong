-- CreateEnum
CREATE TYPE "return_kind" AS ENUM ('BY_ORDER', 'BY_PRODUCT', 'SUPPLIER');

-- CreateTable
CREATE TABLE "goods_returns" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "return_kind" NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_return_lines" (
    "id" SERIAL NOT NULL,
    "returnId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "orderLineId" INTEGER,
    "qty" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "factorUsed" DECIMAL(18,6) NOT NULL,
    "qtyBase" DECIMAL(18,3) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "discountAccumReversed" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "at" TIMESTAMP(3) NOT NULL,
    "seq" BIGINT,

    CONSTRAINT "goods_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "goods_returns_code_key" ON "goods_returns"("code");

-- CreateIndex
CREATE INDEX "goods_returns_periodId_at_idx" ON "goods_returns"("periodId", "at");

-- CreateIndex
CREATE INDEX "goods_returns_partnerId_idx" ON "goods_returns"("partnerId");

-- CreateIndex
CREATE INDEX "goods_returns_orderId_idx" ON "goods_returns"("orderId");

-- CreateIndex
CREATE INDEX "goods_return_lines_returnId_idx" ON "goods_return_lines"("returnId");

-- CreateIndex
CREATE INDEX "goods_return_lines_productId_idx" ON "goods_return_lines"("productId");

-- CreateIndex
CREATE INDEX "goods_return_lines_orderLineId_idx" ON "goods_return_lines"("orderLineId");

-- AddForeignKey
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_return_lines" ADD CONSTRAINT "goods_return_lines_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "goods_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_return_lines" ADD CONSTRAINT "goods_return_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_return_lines" ADD CONSTRAINT "goods_return_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECK: số liệu hợp lệ; trả theo đơn phải có đơn + dòng gốc, loại khác thì không
ALTER TABLE "goods_return_lines" ADD CONSTRAINT "goods_return_lines_values_chk"
  CHECK ("qty" > 0 AND "qtyBase" > 0 AND "unitPrice" >= 0 AND "amount" >= 0 AND "discountAccumReversed" >= 0);
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_total_chk" CHECK ("totalAmount" >= 0);
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_kind_order_chk"
  CHECK (("kind" = 'BY_ORDER') = ("orderId" IS NOT NULL));
