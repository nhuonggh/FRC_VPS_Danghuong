-- Cờ in nợ cũ trên hóa đơn bán hàng (mặc định in như trước).
ALTER TABLE "sale_orders" ADD COLUMN "printDebt" BOOLEAN NOT NULL DEFAULT true;
