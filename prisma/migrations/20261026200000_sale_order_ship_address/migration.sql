-- Địa chỉ giao hàng nhập riêng trên từng đơn bán (tự điền từ khách, sửa được).
ALTER TABLE "sale_orders" ADD COLUMN "shipAddress" TEXT;
