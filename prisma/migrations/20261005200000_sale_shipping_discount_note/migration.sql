-- Phí vận chuyển + chiết khấu cả đơn (đã phân bổ vào dòng) + ghi chú theo dòng. Chỉ thêm cột có mặc định.
ALTER TABLE "sale_orders" ADD COLUMN "shippingFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN "orderDiscount" DECIMAL(18,2) NOT NULL DEFAULT 0;

ALTER TABLE "sale_order_lines" ADD COLUMN "discountOrder" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN "note" TEXT;

ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_shipping_discount_chk" CHECK ("shippingFee" >= 0 AND "orderDiscount" >= 0);
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_discount_order_chk" CHECK ("discountOrder" >= 0 AND "discountOrder" <= "discountNow");
