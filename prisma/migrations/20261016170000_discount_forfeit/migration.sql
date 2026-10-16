-- Tất toán chiết khấu: thêm hình thức "chuyển vào lãi công ty" (không chi tiền, không trừ công nợ). Chỉ thêm giá trị enum.
ALTER TYPE "discount_settle_method" ADD VALUE 'FORFEIT';
