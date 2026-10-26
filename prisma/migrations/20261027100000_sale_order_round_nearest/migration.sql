-- Làm tròn tổng tiền hàng theo quy tắc 500đ cho đơn mới; đơn cũ giữ quy tắc làm tròn lên.
ALTER TABLE "sale_orders" ADD COLUMN "roundNearest" BOOLEAN NOT NULL DEFAULT false;
