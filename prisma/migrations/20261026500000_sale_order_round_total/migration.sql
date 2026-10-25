-- Làm tròn ở mức TỔNG tiền hàng (lên nghìn đồng), thành tiền từng dòng không làm tròn.
-- Mặc định tắt: đơn cũ giữ nguyên (đơn bật "roundAmounts" vẫn làm tròn từng dòng như trước).
ALTER TABLE "sale_orders" ADD COLUMN "roundTotal" BOOLEAN NOT NULL DEFAULT false;
