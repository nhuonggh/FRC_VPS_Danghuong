-- Tùy chọn theo từng đơn: làm tròn LÊN nghìn đồng cho thành tiền từng dòng (mặc định bật = hành vi cũ).
-- Tắt: thành tiền dòng = SL × đơn giá (làm tròn 2 số), để đối chiếu với phần mềm cũ không làm tròn.
ALTER TABLE "sale_orders" ADD COLUMN "roundAmounts" BOOLEAN NOT NULL DEFAULT true;
