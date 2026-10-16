-- Quỹ tiền mặt / tài khoản ngân hàng nhận tiền theo từng điểm giao (mỗi đơn có thể vào quỹ/STK khác nhau).
ALTER TABLE "trip_orders"
  ADD COLUMN "cashAccountId" INTEGER,
  ADD COLUMN "transferAccountId" INTEGER;
