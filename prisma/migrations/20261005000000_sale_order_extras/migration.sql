-- Đơn bán: người bán, kho xuất, hình thức thanh toán dự kiến; sản phẩm: ảnh minh hoạ. Chỉ thêm cột (nullable/default) — không đụng dữ liệu cũ.
CREATE TYPE "sale_payment_method" AS ENUM ('NONE', 'CASH', 'TRANSFER', 'COD');

ALTER TABLE "sale_orders" ADD COLUMN "salesUserId" INTEGER,
ADD COLUMN "warehouseId" INTEGER,
ADD COLUMN "paymentMethod" "sale_payment_method" NOT NULL DEFAULT 'NONE';

ALTER TABLE "products" ADD COLUMN "imageUrl" TEXT;

ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_salesUserId_fkey" FOREIGN KEY ("salesUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
