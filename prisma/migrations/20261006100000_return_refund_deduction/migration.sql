-- Trả hàng của khách: khoản khấu trừ (phí vận chuyển/khác) + liên kết phiếu hoàn tiền (HOAN_KHACH) sinh cùng phiếu trả. Chỉ thêm cột.
ALTER TABLE "goods_returns" ADD COLUMN "deductionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN "deductionNote" TEXT;
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_deduction_chk" CHECK ("deductionAmount" >= 0 AND "deductionAmount" <= "totalAmount");

ALTER TABLE "payments" ADD COLUMN "goodsReturnId" INTEGER;
ALTER TABLE "payments" ADD CONSTRAINT "payments_goodsReturnId_fkey" FOREIGN KEY ("goodsReturnId") REFERENCES "goods_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "payments_goodsReturnId_idx" ON "payments"("goodsReturnId");
