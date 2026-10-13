-- Tiền bớt và phần thu vượt tại điểm giao (chuyến): chỉ thêm cột có mặc định 0.
ALTER TABLE "trip_orders" ADD COLUMN "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0, ADD COLUMN "overAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;
