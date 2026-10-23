-- Dữ liệu: bình khí 1 tên sản phẩm, 2 kiểu (Mua vỏ = kho mã gốc, Đổi khí = kho con mã "-DK").
-- Tra theo MÃ sản phẩm và TÊN kiểu nên DB chưa có các mã này (dev, test) thì không làm gì; chạy lại không đổi thêm.
INSERT INTO "product_stock_lanes" ("productId", "processingTypeId", "stockProductId")
SELECT p."id", pt."id", d."id"
FROM "products" p
JOIN "products" d ON d."code" = p."code" || '-DK'
JOIN "processing_types" pt ON pt."name" = 'Đổi khí'
WHERE p."code" IN ('BANMCVCK', 'BATMCVCK', 'DBKCO2T', 'MBKOXT')
ON CONFLICT DO NOTHING;

-- Mã kho con không hiện ở ô chọn bán/nhập (chỉ hiện ở kiểm kho, tồn đầu kỳ, báo cáo tồn)
UPDATE "products" SET "canSell" = false, "canPurchase" = false, "updatedAt" = now()
WHERE "id" IN (SELECT "stockProductId" FROM "product_stock_lanes") AND ("canSell" OR "canPurchase");

-- Mã gốc trả lại tên không có hậu tố "– Mua vỏ" (tên đã đổi tạm khi tách mã)
UPDATE "products" SET
  "name" = left("name", length("name") - length(' – Mua vỏ')),
  "searchText" = regexp_replace("searchText", ' mua vo$', ''),
  "updatedAt" = now()
WHERE "code" IN ('BANMCVCK', 'BATMCVCK', 'DBKCO2T', 'MBKOXT') AND "name" LIKE '% – Mua vỏ';
