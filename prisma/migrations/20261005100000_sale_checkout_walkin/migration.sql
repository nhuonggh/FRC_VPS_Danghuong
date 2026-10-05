-- Bán lẻ tại quầy: khách lẻ ghi tên/SĐT trên đơn; khách hàng có MST và địa chỉ giao hàng. Chỉ thêm cột nullable.
ALTER TABLE "partners" ADD COLUMN "taxCode" TEXT,
ADD COLUMN "deliveryAddress" TEXT;

ALTER TABLE "sale_orders" ADD COLUMN "walkInName" TEXT,
ADD COLUMN "walkInPhone" TEXT;
