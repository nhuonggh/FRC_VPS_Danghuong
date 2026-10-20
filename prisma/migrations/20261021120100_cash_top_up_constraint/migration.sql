-- Tách file riêng: giá trị enum mới chỉ dùng được sau khi migration thêm giá trị đã commit.
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_partner_chk";
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_partner_chk" CHECK ("partnerId" IS NOT NULL OR "type" IN ('KHAC', 'BO_SUNG_QUY'));
