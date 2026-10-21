-- Vật liệu phụ của dự toán gia công: NULL = giá nhập gần nhất theo BOM (như cũ); có số = giá cố định đ/m dài. Chỉ thêm cột.
ALTER TABLE "reference_cost_plans" ADD COLUMN "auxFixedPerMeter" DECIMAL(18,4);
