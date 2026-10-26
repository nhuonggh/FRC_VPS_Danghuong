-- Dòng bán có kiểu gia công theo định mức: ngoài các NVL trong định mức, còn trừ CHÍNH mã đang bán × tỷ lệ trừ kho của kiểu gia công.
-- Lưu tỷ lệ đã dùng làm snapshot (NULL = đơn cũ / không trừ thêm), nên đổi tỷ lệ của kiểu sau này không đổi đơn đã lập.
ALTER TABLE "sale_order_lines" ADD COLUMN "mainStockRatio" DECIMAL(18,4);
