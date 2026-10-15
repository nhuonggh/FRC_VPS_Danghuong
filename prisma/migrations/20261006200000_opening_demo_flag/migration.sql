-- Cờ "số demo" cho số đầu kỳ (nạp tạm để test, reset khi chạy chính thức). Chỉ thêm cột có mặc định.
ALTER TABLE "opening_stock" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "opening_debt" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "opening_cash" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "opening_discount" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
