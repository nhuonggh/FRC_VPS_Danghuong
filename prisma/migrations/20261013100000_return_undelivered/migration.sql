-- Phiếu trả hàng chưa giao (hàng không giao được trả về kho): chỉ thêm cột có mặc định.
ALTER TABLE "goods_returns" ADD COLUMN "undelivered" BOOLEAN NOT NULL DEFAULT false;
