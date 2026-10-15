-- Cách tính giá của kiểu gia công: mét dài (mặc định, giữ hành vi cũ) hoặc mét vuông. Chỉ thêm kiểu + cột có DEFAULT.
CREATE TYPE "PriceBasis" AS ENUM ('LENGTH', 'AREA');
ALTER TABLE "processing_types" ADD COLUMN "priceBasis" "PriceBasis" NOT NULL DEFAULT 'LENGTH';
