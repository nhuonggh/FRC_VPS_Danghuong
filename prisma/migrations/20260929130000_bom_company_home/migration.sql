-- CreateEnum
CREATE TYPE "bom_version_status" AS ENUM ('DRAFT', 'ACTIVE', 'CANCELLED');

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedBy" INTEGER;

-- CreateTable
CREATE TABLE "boms" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "processingTypeId" INTEGER NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_versions" (
    "id" SERIAL NOT NULL,
    "bomId" INTEGER NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "validFrom" DATE NOT NULL,
    "status" "bom_version_status" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bom_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bom_lines" (
    "id" SERIAL NOT NULL,
    "bomVersionId" INTEGER NOT NULL,
    "materialProductId" INTEGER NOT NULL,
    "qtyPerUnit" DECIMAL(18,3) NOT NULL,
    "note" TEXT,

    CONSTRAINT "bom_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_templates" (
    "id" SERIAL NOT NULL,
    "docType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "secretCiphertext" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "signerName" TEXT,
    "phone" TEXT,
    "qrImage" TEXT,
    "showCompanyInfo" BOOLEAN NOT NULL DEFAULT true,
    "footerNote" TEXT,
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "print_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "boms_productId_processingTypeId_key" ON "boms"("productId", "processingTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "bom_versions_bomId_versionNo_key" ON "bom_versions"("bomId", "versionNo");

-- CreateIndex
CREATE INDEX "bom_lines_materialProductId_idx" ON "bom_lines"("materialProductId");

-- CreateIndex
CREATE UNIQUE INDEX "bom_lines_bomVersionId_materialProductId_key" ON "bom_lines"("bomVersionId", "materialProductId");

-- CreateIndex
CREATE UNIQUE INDEX "print_templates_docType_name_key" ON "print_templates"("docType", "name");

-- AddForeignKey
ALTER TABLE "boms" ADD CONSTRAINT "boms_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boms" ADD CONSTRAINT "boms_processingTypeId_fkey" FOREIGN KEY ("processingTypeId") REFERENCES "processing_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_versions" ADD CONSTRAINT "bom_versions_bomId_fkey" FOREIGN KEY ("bomId") REFERENCES "boms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_bomVersionId_fkey" FOREIGN KEY ("bomVersionId") REFERENCES "bom_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_materialProductId_fkey" FOREIGN KEY ("materialProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Ràng buộc DB (plan 03c Task 16) =====

-- Một ngày hiệu lực chỉ có một phiên bản còn sống cho mỗi BOM (bản đã huỷ nhả ngày ra). Đua ghi → unique violation → service đổi thành 409.
CREATE UNIQUE INDEX "bom_versions_bomId_validFrom_live_key" ON "bom_versions"("bomId", "validFrom") WHERE "status" <> 'CANCELLED';
-- Truy vấn resolveBom: bản ACTIVE mới nhất có validFrom <= ngày.
CREATE INDEX "bom_versions_bomId_status_validFrom_idx" ON "bom_versions"("bomId", "status", "validFrom" DESC);

ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_qty_chk" CHECK ("qtyPerUnit" > 0);

ALTER TABLE "print_templates" ADD CONSTRAINT "print_templates_doctype_chk" CHECK ("docType" ~ '^[A-Z][A-Z0-9_]{1,39}$');
-- Webhook chỉ https (không cho http/file/... để GĐ2 không bị ép gọi địa chỉ nội bộ).
ALTER TABLE "print_templates" ADD CONSTRAINT "print_templates_webhook_https_chk" CHECK ("webhookUrl" IS NULL OR "webhookUrl" ~ '^https://');

-- company_settings luôn đúng một hàng id = 1; đảm bảo hàng tồn tại trên DB cũ (seed vẫn upsert idempotent).
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_singleton_chk" CHECK ("id" = 1);
INSERT INTO "company_settings" ("id", "name") VALUES (1, 'Xưởng tôn Đặng Hương') ON CONFLICT ("id") DO NOTHING;

-- D-19: BOM bất biến. Dòng định mức không bao giờ UPDATE/DELETE; phiên bản chỉ được đổi trạng thái hợp lệ; không xoá.
CREATE FUNCTION bom_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1 FROM "bom_versions" v JOIN "boms" b ON b."id" = v."bomId"
      WHERE v."id" = NEW."bomVersionId" AND b."productId" = NEW."materialProductId"
    ) THEN
      RAISE EXCEPTION 'BOM: nguyên vật liệu không được trùng với chính thành phẩm' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'BOM: dòng định mức bất biến (tạo phiên bản mới thay vì sửa/xoá)' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER bom_lines_guard_ins BEFORE INSERT ON "bom_lines" FOR EACH ROW EXECUTE FUNCTION bom_lines_guard();
CREATE TRIGGER bom_lines_guard_upd BEFORE UPDATE OR DELETE ON "bom_lines" FOR EACH ROW EXECUTE FUNCTION bom_lines_guard();

CREATE FUNCTION bom_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BOM: không xoá phiên bản (chuyển sang CANCELLED)' USING ERRCODE = '23514';
  END IF;
  IF NEW."bomId" IS DISTINCT FROM OLD."bomId" OR NEW."versionNo" IS DISTINCT FROM OLD."versionNo"
     OR NEW."validFrom" IS DISTINCT FROM OLD."validFrom" OR NEW."note" IS DISTINCT FROM OLD."note"
     OR NEW."createdBy" IS DISTINCT FROM OLD."createdBy" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'BOM: phiên bản bất biến, chỉ được đổi trạng thái' USING ERRCODE = '23514';
  END IF;
  IF NOT (NEW."status" = OLD."status"
          OR (OLD."status" = 'DRAFT' AND NEW."status" IN ('ACTIVE', 'CANCELLED'))
          OR (OLD."status" = 'ACTIVE' AND NEW."status" = 'CANCELLED')) THEN
    RAISE EXCEPTION 'BOM: chuyển trạng thái phiên bản không hợp lệ' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bom_versions_guard_trg BEFORE UPDATE OR DELETE ON "bom_versions" FOR EACH ROW EXECUTE FUNCTION bom_versions_guard();
