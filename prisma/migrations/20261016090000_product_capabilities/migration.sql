-- Preserve product IDs, stock, FIFO layers and historical documents.
ALTER TABLE "products"
  ADD COLUMN "canSell" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canPurchase" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "canUseAsMaterial" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canProduce" BOOLEAN NOT NULL DEFAULT false;
UPDATE "products" SET
  "canUseAsMaterial" = kind IN ('NVL', 'HANG', 'PHU_KIEN'),
  "canProduce" = kind IN ('THANH_PHAM', 'PHU_KIEN');

ALTER TABLE "sale_order_lines" ADD COLUMN "issueMode" TEXT NOT NULL DEFAULT 'LEGACY';
-- Posted lines already encode their actual stock behavior via their BOM snapshot.
UPDATE "sale_order_lines" AS l SET "issueMode" = CASE WHEN l."bomVersionId" IS NULL THEN 'STOCK' ELSE 'BOM' END
FROM "sale_orders" AS o WHERE l."orderId" = o.id AND NOT o."isDraft";
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_issue_mode_check" CHECK ("issueMode" IN ('LEGACY', 'STOCK', 'BOM'));
