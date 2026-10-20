-- Ghi chú dòng phiếu trả (trả theo kích thước ghi dài × tỷ lệ × số tấm). Chỉ thêm cột, dữ liệu cũ để NULL.
ALTER TABLE "goods_return_lines" ADD COLUMN "note" TEXT;
