-- Khoá thứ tự ghi sổ ỔN ĐỊNH (plan 02 Task 4, vòng sửa 5): engine sắp sự kiện cùng `at` theo `seq`, không theo id.
-- Sửa chứng từ = xoá + ghi lại → id mới, nhưng module nghiệp vụ lưu `seq` cùng dòng chứng từ (như `at`) và truyền lại
-- → vị trí FIFO không đổi. Không bao giờ nạp lại hàng loạt dòng sổ mà không giữ `seq`.
CREATE SEQUENCE "stock_ledger_seq_seq";

ALTER TABLE "stock_ledger" ADD COLUMN "seq" BIGINT;
UPDATE "stock_ledger" SET "seq" = "id";
SELECT setval('stock_ledger_seq_seq', COALESCE((SELECT MAX("seq") FROM "stock_ledger"), 0) + 1, false);
ALTER TABLE "stock_ledger" ALTER COLUMN "seq" SET NOT NULL;
ALTER TABLE "stock_ledger" ALTER COLUMN "seq" SET DEFAULT nextval('stock_ledger_seq_seq'::regclass);
ALTER SEQUENCE "stock_ledger_seq_seq" OWNED BY "stock_ledger"."seq";

-- CreateIndex
CREATE UNIQUE INDEX "stock_ledger_seq_key" ON "stock_ledger"("seq");
