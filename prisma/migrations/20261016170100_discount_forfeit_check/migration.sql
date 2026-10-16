-- Tách khỏi migration thêm giá trị enum (Postgres không cho dùng giá trị enum mới trong cùng giao dịch).
-- Tiền mặt ⇔ có phiếu chi; trừ nợ / chuyển vào lãi công ty ⇔ không có phiếu chi.
ALTER TABLE "discount_settlements" DROP CONSTRAINT "discount_settlements_method_chk";
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_method_chk" CHECK (("method" = 'CASH' AND "paymentId" IS NOT NULL) OR ("method" IN ('OFFSET', 'FORFEIT') AND "paymentId" IS NULL));
