-- Gắn kiểu gia công cho từng sản phẩm: một dòng (sản phẩm × kiểu) = sản phẩm có kiểu đó; ratio NULL = dùng tỷ lệ mặc định của kiểu.
-- Dòng đang có (tỷ lệ đã khai báo) mặc nhiên là đã gắn.
ALTER TABLE "product_processing_ratios" ALTER COLUMN "ratio" DROP NOT NULL;
