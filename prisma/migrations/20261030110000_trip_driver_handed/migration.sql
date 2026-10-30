-- Đối soát lái xe: ghi tiền mặt lái xe thực giao nộp (để tính tiền kế toán trả lại). Chỉ thêm cột.
ALTER TABLE "trips" ADD COLUMN "driverHandedAmount" DECIMAL(18,2);
