-- FILE SINH TỰ ĐỘNG bằng scripts/gen-db-schema.sh — KHÔNG sửa tay.
-- Nguồn sự thật: prisma/schema/*.prisma + prisma/migrations/*/migration.sql

-- >>> prisma/migrations/20260924152222_foundation/migration.sql
-- CreateEnum
CREATE TYPE "stock_doc_type" AS ENUM ('OPENING', 'PURCHASE', 'ADJ_IN', 'RETURN_IN', 'PRODUCTION_OUT', 'STOCKTAKE_IN', 'SALE', 'ADJ_LOSS', 'WRITE_OFF', 'RETURN_SUPPLIER', 'PRODUCTION_USE', 'PROCESSING_USE', 'STOCKTAKE_OUT');

-- CreateEnum
CREATE TYPE "discount_settle_method" AS ENUM ('CASH', 'OFFSET');

-- CreateEnum
CREATE TYPE "product_kind" AS ENUM ('HANG', 'NVL', 'THANH_PHAM', 'PHU_KIEN');

-- CreateEnum
CREATE TYPE "cash_type" AS ENUM ('CASH', 'BANK');

-- CreateEnum
CREATE TYPE "period_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "stock_ledger" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "docType" "stock_doc_type" NOT NULL,
    "docId" INTEGER NOT NULL,
    "docLineId" INTEGER NOT NULL,
    "qtyIn" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "qtyOut" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unitCostOut" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "qtyProvisional" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "at" TIMESTAMP(3) NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_layers" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "sourceDocType" "stock_doc_type" NOT NULL,
    "sourceDocId" INTEGER NOT NULL,
    "sourceLineId" INTEGER NOT NULL,
    "ledgerId" INTEGER NOT NULL,
    "qtyIn" DECIMAL(18,3) NOT NULL,
    "qtyRemaining" DECIMAL(18,3) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "costRefType" "stock_doc_type",
    "costRefId" INTEGER,
    "costRefQty" DECIMAL(18,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_layers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_consumptions" (
    "id" SERIAL NOT NULL,
    "layerId" INTEGER NOT NULL,
    "ledgerId" INTEGER NOT NULL,
    "docType" "stock_doc_type" NOT NULL,
    "docLineId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "cost_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_ledger" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "docType" TEXT NOT NULL,
    "docId" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_ledger" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "cashAccountId" INTEGER NOT NULL,
    "amountIn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountOut" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "docType" TEXT NOT NULL,
    "docId" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_ledger" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "orderLineId" INTEGER,
    "amountIn" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountOut" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "settleMethod" "discount_settle_method",
    "docType" TEXT NOT NULL,
    "docId" INTEGER NOT NULL,
    "isReconciled" BOOLEAN NOT NULL DEFAULT false,
    "reconciledBy" INTEGER,
    "reconciledAt" TIMESTAMP(3),
    "at" TIMESTAMP(3) NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_groups" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "partner_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "searchText" TEXT NOT NULL DEFAULT '',
    "groupId" INTEGER NOT NULL,
    "isCustomer" BOOLEAN NOT NULL DEFAULT true,
    "isSupplier" BOOLEAN NOT NULL DEFAULT false,
    "ownerUserId" INTEGER,
    "debtLimit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "allowCredit" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "address" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mergedIntoId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "searchText" TEXT NOT NULL DEFAULT '',
    "kind" "product_kind" NOT NULL DEFAULT 'HANG',
    "baseUnit" TEXT NOT NULL,
    "minStock" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "recomputing" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_units" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,

    CONSTRAINT "product_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_accounts" (
    "id" SERIAL NOT NULL,
    "type" "cash_type" NOT NULL,
    "name" TEXT NOT NULL,
    "bankNo" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cash_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "periods" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "status" "period_status" NOT NULL DEFAULT 'OPEN',
    "isOpen" BOOLEAN,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedBy" INTEGER,

    CONSTRAINT "periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_stock" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "opening_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_debt" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "opening_debt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_cash" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "cashAccountId" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "opening_cash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opening_discount" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "opening_discount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" INTEGER NOT NULL,
    "permissionId" INTEGER NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" INTEGER NOT NULL,
    "roleId" INTEGER NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "taxCode" TEXT,
    "logo" TEXT,
    "bankInfo" JSONB,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "userId" INTEGER NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "responseJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("userId","scope","key")
);

-- CreateIndex
CREATE INDEX "stock_ledger_periodId_productId_at_idx" ON "stock_ledger"("periodId", "productId", "at");

-- CreateIndex
CREATE INDEX "stock_ledger_docType_docId_idx" ON "stock_ledger"("docType", "docId");

-- CreateIndex
CREATE INDEX "stock_ledger_docType_docLineId_idx" ON "stock_ledger"("docType", "docLineId");

-- CreateIndex
CREATE UNIQUE INDEX "cost_layers_ledgerId_key" ON "cost_layers"("ledgerId");

-- CreateIndex
CREATE INDEX "cost_layers_periodId_productId_at_idx" ON "cost_layers"("periodId", "productId", "at");

-- CreateIndex
CREATE INDEX "cost_layers_costRefType_costRefId_idx" ON "cost_layers"("costRefType", "costRefId");

-- CreateIndex
CREATE INDEX "cost_consumptions_layerId_idx" ON "cost_consumptions"("layerId");

-- CreateIndex
CREATE INDEX "cost_consumptions_ledgerId_idx" ON "cost_consumptions"("ledgerId");

-- CreateIndex
CREATE INDEX "cost_consumptions_docType_docLineId_idx" ON "cost_consumptions"("docType", "docLineId");

-- CreateIndex
CREATE INDEX "partner_ledger_periodId_partnerId_at_idx" ON "partner_ledger"("periodId", "partnerId", "at");

-- CreateIndex
CREATE INDEX "partner_ledger_docType_docId_idx" ON "partner_ledger"("docType", "docId");

-- CreateIndex
CREATE INDEX "cash_ledger_periodId_cashAccountId_at_idx" ON "cash_ledger"("periodId", "cashAccountId", "at");

-- CreateIndex
CREATE INDEX "cash_ledger_docType_docId_idx" ON "cash_ledger"("docType", "docId");

-- CreateIndex
CREATE INDEX "discount_ledger_periodId_partnerId_at_idx" ON "discount_ledger"("periodId", "partnerId", "at");

-- CreateIndex
CREATE INDEX "discount_ledger_docType_docId_idx" ON "discount_ledger"("docType", "docId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_groups_name_key" ON "partner_groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "partners_code_key" ON "partners"("code");

-- CreateIndex
CREATE INDEX "partners_groupId_idx" ON "partners"("groupId");

-- CreateIndex
CREATE INDEX "partners_ownerUserId_idx" ON "partners"("ownerUserId");

-- CreateIndex
CREATE INDEX "partners_searchText_idx" ON "partners"("searchText");

-- CreateIndex
CREATE UNIQUE INDEX "products_code_key" ON "products"("code");

-- CreateIndex
CREATE INDEX "products_searchText_idx" ON "products"("searchText");

-- CreateIndex
CREATE INDEX "products_kind_idx" ON "products"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "product_units_productId_unit_key" ON "product_units"("productId", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_name_key" ON "warehouses"("name");

-- CreateIndex
CREATE UNIQUE INDEX "cash_accounts_name_key" ON "cash_accounts"("name");

-- CreateIndex
CREATE UNIQUE INDEX "periods_isOpen_key" ON "periods"("isOpen");

-- CreateIndex
CREATE INDEX "opening_stock_periodId_productId_idx" ON "opening_stock"("periodId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "opening_debt_periodId_partnerId_key" ON "opening_debt"("periodId", "partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "opening_cash_periodId_cashAccountId_key" ON "opening_cash"("periodId", "cashAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "opening_discount_periodId_partnerId_key" ON "opening_discount"("periodId", "partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "audit_log_entity_entityId_idx" ON "audit_log"("entity", "entityId");

-- CreateIndex
CREATE INDEX "audit_log_userId_at_idx" ON "audit_log"("userId", "at");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- CreateIndex
CREATE INDEX "idempotency_keys_createdAt_idx" ON "idempotency_keys"("createdAt");

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_layers" ADD CONSTRAINT "cost_layers_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_layers" ADD CONSTRAINT "cost_layers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_layers" ADD CONSTRAINT "cost_layers_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "stock_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_consumptions" ADD CONSTRAINT "cost_consumptions_layerId_fkey" FOREIGN KEY ("layerId") REFERENCES "cost_layers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_consumptions" ADD CONSTRAINT "cost_consumptions_ledgerId_fkey" FOREIGN KEY ("ledgerId") REFERENCES "stock_ledger"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_ledger" ADD CONSTRAINT "partner_ledger_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_ledger" ADD CONSTRAINT "partner_ledger_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_ledger" ADD CONSTRAINT "cash_ledger_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_ledger" ADD CONSTRAINT "cash_ledger_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_ledger" ADD CONSTRAINT "discount_ledger_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_ledger" ADD CONSTRAINT "discount_ledger_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "partner_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_stock" ADD CONSTRAINT "opening_stock_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_stock" ADD CONSTRAINT "opening_stock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_debt" ADD CONSTRAINT "opening_debt_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_debt" ADD CONSTRAINT "opening_debt_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_cash" ADD CONSTRAINT "opening_cash_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_cash" ADD CONSTRAINT "opening_cash_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_discount" ADD CONSTRAINT "opening_discount_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_discount" ADD CONSTRAINT "opening_discount_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- SQL THÔ — những ràng buộc Prisma không mô hình được
-- ============================================================================

-- 1. Kỳ: isOpen khớp status (true ⇔ OPEN, NULL ⇔ CLOSED). Cùng với UNIQUE(isOpen) → đúng 1 kỳ OPEN.
ALTER TABLE periods ADD CONSTRAINT periods_open_flag_chk
  CHECK ((status = 'OPEN' AND "isOpen" IS TRUE) OR (status = 'CLOSED' AND "isOpen" IS NULL));

-- 2. Engine kho
ALTER TABLE cost_layers ADD CONSTRAINT cost_layers_qty_chk
  CHECK ("qtyIn" > 0 AND "qtyRemaining" >= 0 AND "qtyRemaining" <= "qtyIn");

ALTER TABLE cost_consumptions ADD CONSTRAINT cost_consumptions_qty_chk
  CHECK (qty > 0);

ALTER TABLE stock_ledger ADD CONSTRAINT stock_ledger_qty_chk
  CHECK ("qtyIn" >= 0 AND "qtyOut" >= 0
         AND (("qtyIn" > 0) <> ("qtyOut" > 0))
         AND "qtyProvisional" >= 0 AND "qtyProvisional" <= "qtyOut");

-- 3. audit_log APPEND-ONLY: trigger chặn cả chủ sở hữu DB
CREATE FUNCTION audit_log_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log là append-only: không được % dữ liệu', TG_OP
    USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_block_mutation();

-- 4. Role ứng dụng app_rw (D-2): tạo role ở runbook (chứa mật khẩu nên không nằm trong migration).
--    Nếu role đã tồn tại thì cấp quyền; audit_log chỉ INSERT/SELECT.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    GRANT USAGE ON SCHEMA public TO app_rw;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw;
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_rw;
    -- bảng/sequence tạo ở các migration sau tự có quyền cho app_rw
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO app_rw;
  END IF;
END $$;

-- >>> prisma/migrations/20260925003859_engine_support/migration.sql
-- CreateEnum
CREATE TYPE "recompute_status" AS ENUM ('PENDING', 'RUNNING', 'FAILED');

-- CreateTable
CREATE TABLE "recompute_jobs" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "fromAt" TIMESTAMP(3) NOT NULL,
    "status" "recompute_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recompute_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recompute_jobs_productId_key" ON "recompute_jobs"("productId");

-- CreateIndex
CREATE INDEX "recompute_jobs_status_id_idx" ON "recompute_jobs"("status", "id");

-- CreateIndex
CREATE INDEX "stock_ledger_periodId_productId_qtyProvisional_idx" ON "stock_ledger"("periodId", "productId", "qtyProvisional");

-- >>> prisma/migrations/20260925120000_ledger_seq/migration.sql
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

-- >>> prisma/migrations/20260926090000_user_email/migration.sql
-- Đăng nhập Google (thay D-1: Credentials + Google). Email là khoá khớp DUY NHẤT giữa tài khoản Google và user:
-- chỉ quản trị (user.manage) đặt được; không bao giờ tự tạo user từ Google.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "email" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- SQL THÔ — Prisma không mô hình được CHECK.
-- Email lưu đã chuẩn hoá (chữ thường, không khoảng trắng, không rỗng) → UNIQUE ở trên cũng chặn trùng không phân biệt
-- hoa/thường. Ứng dụng chuẩn hoá trước khi ghi (normalizeEmail). btrim() mặc định chỉ cắt dấu cách → thêm điều kiện
-- "không có ký tự trắng nào" ([[:space:]]: tab, xuống dòng…) — email hợp lệ không bao giờ chứa khoảng trắng.
ALTER TABLE users ADD CONSTRAINT users_email_normalized_chk
  CHECK (email = lower(email) AND email = btrim(email) AND email <> '' AND email !~ '[[:space:]]');

-- Quyền app_rw: GRANT ở mức BẢNG (migration foundation) đã phủ mọi cột, kể cả cột thêm sau — không cần GRANT mới.

-- >>> prisma/migrations/20260926100000_user_temp_password_expiry/migration.sql
-- Fix round 1 (review bảo mật đăng nhập Google):
--  * tempPasswordExpiresAt: mật khẩu tạm có hạn (72 giờ, TEMP_PASSWORD_TTL_HOURS) — người chỉ dùng Google không để lại
--    một mật khẩu tạm dùng được mãi mãi.
--  * emailChangedAt: đổi/gỡ email làm hết hiệu lực phiên Google đang mở (so với authAt trong JWT).
-- Tên cột camelCase theo quy ước sẵn có của bảng users ("passwordHash", "mustChangePassword").

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailChangedAt" TIMESTAMPTZ(3),
ADD COLUMN     "tempPasswordExpiresAt" TIMESTAMPTZ(3);

-- Backfill: mật khẩu tạm ĐANG tồn tại (tài khoản chờ đổi mật khẩu) cũng có hạn, tính từ lúc migrate.
UPDATE "users" SET "tempPasswordExpiresAt" = now() + interval '72 hours' WHERE "mustChangePassword" = true;

-- Quyền app_rw: GRANT mức bảng (migration foundation) phủ cả cột mới.

-- >>> prisma/migrations/20260927043653_catalog_foundation/migration.sql
-- AlterTable
ALTER TABLE "partner_groups" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "isCoil" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "vehicles" (
    "id" SERIAL NOT NULL,
    "plate" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isAssistant" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "expense_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "processing_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_key" ON "vehicles"("plate");

-- CreateIndex
CREATE UNIQUE INDEX "routes_name_key" ON "routes"("name");

-- CreateIndex
CREATE UNIQUE INDEX "expense_types_name_key" ON "expense_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "processing_types_name_key" ON "processing_types"("name");

-- Ràng buộc mức DB (lớp chặn thứ hai sau zod): dữ liệu sai không bao giờ vào được,
-- kể cả đi qua import/script.
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_factor_pos_chk" CHECK ("factor" > 0);
ALTER TABLE "products" ADD CONSTRAINT "products_min_stock_nonneg_chk" CHECK ("minStock" >= 0);
ALTER TABLE "partners" ADD CONSTRAINT "partners_debt_limit_nonneg_chk" CHECK ("debtLimit" >= 0);
ALTER TABLE "partners" ADD CONSTRAINT "partners_kind_chk" CHECK ("isCustomer" OR "isSupplier");

-- >>> prisma/migrations/20260927125310_purchasing/migration.sql
-- CreateEnum
CREATE TYPE "stock_adjustment_type" AS ENUM ('IN_NO_SUPPLIER', 'LOSS', 'WRITE_OFF', 'STOCKTAKE');

-- CreateTable
CREATE TABLE "purchases" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "freightCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "purchaseTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" SERIAL NOT NULL,
    "purchaseId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "factorUsed" DECIMAL(18,6) NOT NULL,
    "qtyBase" DECIMAL(18,3) NOT NULL,
    "purchasePrice" DECIMAL(18,2) NOT NULL,
    "purchaseAmount" DECIMAL(18,2) NOT NULL,
    "allocatedFreight" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "rollInfo" TEXT,
    "rollSearch" TEXT NOT NULL DEFAULT '',
    "seq" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "type" "stock_adjustment_type" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_lines" (
    "id" SERIAL NOT NULL,
    "adjustmentId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unitCost" DECIMAL(18,4) NOT NULL,
    "seq" BIGINT,

    CONSTRAINT "stock_adjustment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchases_code_key" ON "purchases"("code");

-- CreateIndex
CREATE INDEX "purchases_periodId_at_idx" ON "purchases"("periodId", "at");

-- CreateIndex
CREATE INDEX "purchases_partnerId_at_idx" ON "purchases"("partnerId", "at");

-- CreateIndex
CREATE INDEX "purchase_lines_purchaseId_idx" ON "purchase_lines"("purchaseId");

-- CreateIndex
CREATE INDEX "purchase_lines_productId_idx" ON "purchase_lines"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_code_key" ON "stock_adjustments"("code");

-- CreateIndex
CREATE INDEX "stock_adjustments_periodId_at_idx" ON "stock_adjustments"("periodId", "at");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_adjustmentId_idx" ON "stock_adjustment_lines"("adjustmentId");

-- CreateIndex
CREATE INDEX "stock_adjustment_lines_productId_idx" ON "stock_adjustment_lines"("productId");

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "stock_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lớp chặn DB cho dữ liệu phiếu nhập: cả import/script cũng không ghi được số âm/0 sai quy ước.
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_amounts_nonneg_chk"
  CHECK ("freightCost" >= 0 AND "purchaseTotal" >= 0);
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_values_chk"
  CHECK ("qty" > 0 AND "factorUsed" > 0 AND "qtyBase" > 0 AND "purchasePrice" >= 0 AND "purchaseAmount" >= 0 AND "allocatedFreight" >= 0);
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_values_chk"
  CHECK ("qty" > 0 AND "unitCost" >= 0);

-- >>> prisma/migrations/20260929130000_bom_company_home/migration.sql
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

-- >>> prisma/migrations/20260930090000_sales_orders/migration.sql
-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('NEW', 'WAITING_STOCK', 'READY', 'LOADED', 'DELIVERING', 'DELIVERED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('UNPAID', 'DEPOSITED', 'PARTIAL', 'PAID', 'DEBT', 'PROMISED', 'OVERPAID');

-- CreateTable
CREATE TABLE "sale_orders" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "deliveryStatus" "delivery_status" NOT NULL DEFAULT 'NEW',
    "paymentStatus" "payment_status" NOT NULL DEFAULT 'UNPAID',
    "orderDate" TIMESTAMP(3) NOT NULL,
    "expectedDeliveryDate" DATE NOT NULL,
    "originalDeliveryDate" DATE NOT NULL,
    "note" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_order_lines" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "factorUsed" DECIMAL(18,6) NOT NULL,
    "qtyBase" DECIMAL(18,3) NOT NULL,
    "salePrice" DECIMAL(18,2) NOT NULL,
    "discountNow" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountAccum" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unitCostFifo" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "processingTypeId" INTEGER,
    "bomVersionId" INTEGER,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_line_issues" (
    "id" SERIAL NOT NULL,
    "orderLineId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qtyBase" DECIMAL(18,3) NOT NULL,
    "seq" BIGINT,

    CONSTRAINT "sale_line_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_notes" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_lines" (
    "id" SERIAL NOT NULL,
    "deliveryNoteId" INTEGER NOT NULL,
    "orderLineId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "delivery_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sale_orders_code_key" ON "sale_orders"("code");

-- CreateIndex
CREATE INDEX "sale_orders_periodId_orderDate_idx" ON "sale_orders"("periodId", "orderDate");

-- CreateIndex
CREATE INDEX "sale_orders_partnerId_orderDate_idx" ON "sale_orders"("partnerId", "orderDate");

-- CreateIndex
CREATE INDEX "sale_orders_expectedDeliveryDate_idx" ON "sale_orders"("expectedDeliveryDate");

-- CreateIndex
CREATE INDEX "sale_order_lines_orderId_idx" ON "sale_order_lines"("orderId");

-- CreateIndex
CREATE INDEX "sale_order_lines_productId_idx" ON "sale_order_lines"("productId");

-- CreateIndex
CREATE INDEX "sale_line_issues_productId_idx" ON "sale_line_issues"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_line_issues_orderLineId_productId_key" ON "sale_line_issues"("orderLineId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_notes_code_key" ON "delivery_notes"("code");

-- CreateIndex
CREATE INDEX "delivery_notes_orderId_idx" ON "delivery_notes"("orderId");

-- CreateIndex
CREATE INDEX "delivery_notes_periodId_at_idx" ON "delivery_notes"("periodId", "at");

-- CreateIndex
CREATE INDEX "delivery_lines_deliveryNoteId_idx" ON "delivery_lines"("deliveryNoteId");

-- CreateIndex
CREATE INDEX "delivery_lines_orderLineId_idx" ON "delivery_lines"("orderLineId");

-- CreateIndex
CREATE INDEX "discount_ledger_orderLineId_idx" ON "discount_ledger"("orderLineId");

-- AddForeignKey
ALTER TABLE "discount_ledger" ADD CONSTRAINT "discount_ledger_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sale_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_processingTypeId_fkey" FOREIGN KEY ("processingTypeId") REFERENCES "processing_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_bomVersionId_fkey" FOREIGN KEY ("bomVersionId") REFERENCES "bom_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_issues" ADD CONSTRAINT "sale_line_issues_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "sale_order_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_issues" ADD CONSTRAINT "sale_line_issues_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_notes" ADD CONSTRAINT "delivery_notes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "delivery_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Ràng buộc DB (plan 04 Task C1) =====
-- Lớp chặn cuối cho import/script: số lượng, giá, chiết khấu không âm; tổng chiết khấu không vượt giá trị dòng.
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_values_chk" CHECK (
  "qty" > 0 AND "factorUsed" > 0 AND "qtyBase" > 0 AND "salePrice" >= 0
  AND "discountNow" >= 0 AND "discountAccum" >= 0 AND "unitCostFifo" >= 0
  AND "discountNow" + "discountAccum" <= "qty" * "salePrice"
);
ALTER TABLE "sale_line_issues" ADD CONSTRAINT "sale_line_issues_qty_chk" CHECK ("qtyBase" > 0);
ALTER TABLE "delivery_lines" ADD CONSTRAINT "delivery_lines_qty_chk" CHECK ("qty" > 0);
-- Ngày giao dự kiến chỉ được dời về phía sau; original giữ nguyên để tính số ngày trễ.
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_expected_chk" CHECK ("expectedDeliveryDate" >= "originalDeliveryDate");

-- >>> prisma/migrations/20260930120000_sales_quotes_deposits/migration.sql
-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('DRAFT', 'SENT', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "receipt_type" AS ENUM ('THU_NO', 'COC', 'KHAC');

-- AlterTable
ALTER TABLE "sale_orders" ADD COLUMN     "isDraft" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "quotes" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "status" "quote_status" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "convertedOrderId" INTEGER,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_lines" (
    "id" SERIAL NOT NULL,
    "quoteId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "salePrice" DECIMAL(18,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "type" "receipt_type" NOT NULL,
    "orderId" INTEGER,
    "amount" DECIMAL(18,2) NOT NULL,
    "cashAccountId" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotes_code_key" ON "quotes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_convertedOrderId_key" ON "quotes"("convertedOrderId");

-- CreateIndex
CREATE INDEX "quotes_periodId_at_idx" ON "quotes"("periodId", "at");

-- CreateIndex
CREATE INDEX "quotes_partnerId_idx" ON "quotes"("partnerId");

-- CreateIndex
CREATE INDEX "quote_lines_quoteId_idx" ON "quote_lines"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_code_key" ON "receipts"("code");

-- CreateIndex
CREATE INDEX "receipts_orderId_idx" ON "receipts"("orderId");

-- CreateIndex
CREATE INDEX "receipts_periodId_at_idx" ON "receipts"("periodId", "at");

-- CreateIndex
CREATE INDEX "receipts_partnerId_idx" ON "receipts"("partnerId");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_convertedOrderId_fkey" FOREIGN KEY ("convertedOrderId") REFERENCES "sale_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===== Ràng buộc DB (plan 04 Task C5) =====
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_values_chk" CHECK ("qty" > 0 AND "salePrice" >= 0);
-- Tiền thu phải dương; phiếu COC/THU_NO vào quỹ nên luôn có tài khoản (cashAccountId NOT NULL)
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_amount_chk" CHECK ("amount" > 0);
-- Báo giá đã chuyển thành đơn phải trỏ tới đơn và ngược lại
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_converted_chk" CHECK (("status" = 'CONVERTED') = ("convertedOrderId" IS NOT NULL));

-- >>> prisma/migrations/20260930150000_goods_returns/migration.sql
-- CreateEnum
CREATE TYPE "return_kind" AS ENUM ('BY_ORDER', 'BY_PRODUCT', 'SUPPLIER');

-- CreateTable
CREATE TABLE "goods_returns" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "return_kind" NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_return_lines" (
    "id" SERIAL NOT NULL,
    "returnId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "orderLineId" INTEGER,
    "qty" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "factorUsed" DECIMAL(18,6) NOT NULL,
    "qtyBase" DECIMAL(18,3) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "discountAccumReversed" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "at" TIMESTAMP(3) NOT NULL,
    "seq" BIGINT,

    CONSTRAINT "goods_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "goods_returns_code_key" ON "goods_returns"("code");

-- CreateIndex
CREATE INDEX "goods_returns_periodId_at_idx" ON "goods_returns"("periodId", "at");

-- CreateIndex
CREATE INDEX "goods_returns_partnerId_idx" ON "goods_returns"("partnerId");

-- CreateIndex
CREATE INDEX "goods_returns_orderId_idx" ON "goods_returns"("orderId");

-- CreateIndex
CREATE INDEX "goods_return_lines_returnId_idx" ON "goods_return_lines"("returnId");

-- CreateIndex
CREATE INDEX "goods_return_lines_productId_idx" ON "goods_return_lines"("productId");

-- CreateIndex
CREATE INDEX "goods_return_lines_orderLineId_idx" ON "goods_return_lines"("orderLineId");

-- AddForeignKey
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_return_lines" ADD CONSTRAINT "goods_return_lines_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "goods_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_return_lines" ADD CONSTRAINT "goods_return_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_return_lines" ADD CONSTRAINT "goods_return_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "sale_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECK: số liệu hợp lệ; trả theo đơn phải có đơn + dòng gốc, loại khác thì không
ALTER TABLE "goods_return_lines" ADD CONSTRAINT "goods_return_lines_values_chk"
  CHECK ("qty" > 0 AND "qtyBase" > 0 AND "unitPrice" >= 0 AND "amount" >= 0 AND "discountAccumReversed" >= 0);
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_total_chk" CHECK ("totalAmount" >= 0);
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_kind_order_chk"
  CHECK (("kind" = 'BY_ORDER') = ("orderId" IS NOT NULL));

-- >>> prisma/migrations/20260930180000_debt_adjust_transfer/migration.sql
-- CreateEnum
CREATE TYPE "debt_adjust_reason" AS ENUM ('HANG_LOI', 'BEP_MOP', 'CHIET_KHAU', 'KHAC');

-- CreateEnum
CREATE TYPE "debt_transfer_kind" AS ENUM ('TRANSFER', 'MERGE');

-- CreateTable
CREATE TABLE "debt_adjustments" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "reason" "debt_adjust_reason" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_transfers" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "debt_transfer_kind" NOT NULL,
    "fromPartnerId" INTEGER NOT NULL,
    "toPartnerId" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "discountMoved" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "debt_adjustments_code_key" ON "debt_adjustments"("code");

-- CreateIndex
CREATE INDEX "debt_adjustments_periodId_at_idx" ON "debt_adjustments"("periodId", "at");

-- CreateIndex
CREATE INDEX "debt_adjustments_partnerId_idx" ON "debt_adjustments"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "debt_transfers_code_key" ON "debt_transfers"("code");

-- CreateIndex
CREATE INDEX "debt_transfers_periodId_at_idx" ON "debt_transfers"("periodId", "at");

-- CreateIndex
CREATE INDEX "debt_transfers_fromPartnerId_idx" ON "debt_transfers"("fromPartnerId");

-- CreateIndex
CREATE INDEX "debt_transfers_toPartnerId_idx" ON "debt_transfers"("toPartnerId");

-- AddForeignKey
ALTER TABLE "debt_adjustments" ADD CONSTRAINT "debt_adjustments_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_adjustments" ADD CONSTRAINT "debt_adjustments_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_transfers" ADD CONSTRAINT "debt_transfers_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_transfers" ADD CONSTRAINT "debt_transfers_fromPartnerId_fkey" FOREIGN KEY ("fromPartnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_transfers" ADD CONSTRAINT "debt_transfers_toPartnerId_fkey" FOREIGN KEY ("toPartnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECK: điều chỉnh khác 0; chuyển khác đối tác, khác 0 trừ khi gộp; chiết khấu chuyển kèm chỉ khi gộp
ALTER TABLE "debt_adjustments" ADD CONSTRAINT "debt_adjustments_amount_chk" CHECK ("amount" <> 0);
ALTER TABLE "debt_transfers" ADD CONSTRAINT "debt_transfers_partners_chk" CHECK ("fromPartnerId" <> "toPartnerId");
ALTER TABLE "debt_transfers" ADD CONSTRAINT "debt_transfers_amount_chk" CHECK ("kind" = 'MERGE' OR "amount" <> 0);
ALTER TABLE "debt_transfers" ADD CONSTRAINT "debt_transfers_discount_chk" CHECK ("discountMoved" >= 0 AND ("kind" = 'MERGE' OR "discountMoved" = 0));

-- >>> prisma/migrations/20260930200000_grant_sales_debt_permissions/migration.sql
-- Cấp MỘT LẦN các quyền của plan 04 cho vai trò mẫu đã tồn tại (chỉ THÊM, không gỡ; vai trò/quyền chưa có thì bỏ qua).
-- Seed chỉ gán quyền mặc định cho vai trò MỚI tạo nên vai trò cũ (Bán hàng, Kế toán) không tự nhận quyền mới.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
JOIN "permissions" p ON
  (r.name = 'Bán hàng' AND p.code IN ('order.edit_price', 'quote.manage', 'deposit.manage', 'return.manage'))
  OR (r.name = 'Kế toán' AND p.code IN ('order.edit_price', 'order.delete_draft', 'quote.manage', 'deposit.manage', 'return.manage', 'debt.view', 'debt.adjust'))
  OR (r.name = 'Thủ quỹ' AND p.code IN ('debt.view'))
ON CONFLICT DO NOTHING;

-- >>> prisma/migrations/20260930230000_cash_vouchers/migration.sql
-- CreateEnum
CREATE TYPE "cash_review_status" AS ENUM ('PENDING_REVIEW', 'REVIEWED', 'RETURNED');

-- CreateEnum
CREATE TYPE "payment_kind" AS ENUM ('TRA_NCC', 'HOAN_KHACH', 'CHI_PHI', 'TAT_TOAN_CK', 'KHAC');

-- CreateEnum
CREATE TYPE "cash_adjustment_kind" AS ENUM ('AMOUNT', 'VOID');

-- CreateEnum
CREATE TYPE "cash_adjustment_status" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "reviewStatus" "cash_review_status" NOT NULL DEFAULT 'PENDING_REVIEW',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" INTEGER,
ALTER COLUMN "partnerId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "payment_kind" NOT NULL,
    "partnerId" INTEGER,
    "amount" DECIMAL(18,2) NOT NULL,
    "cashAccountId" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "reviewStatus" "cash_review_status" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedBy" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_review_events" (
    "id" SERIAL NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "userId" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_review_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_adjustments" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" INTEGER NOT NULL,
    "kind" "cash_adjustment_kind" NOT NULL,
    "status" "cash_adjustment_status" NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "newAmount" DECIMAL(18,2),
    "newCashAccountId" INTEGER,
    "oldAmount" DECIMAL(18,2),
    "oldCashAccountId" INTEGER,
    "requestedBy" INTEGER NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,

    CONSTRAINT "cash_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_closes" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "cashAccountId" INTEGER NOT NULL,
    "closeAt" TIMESTAMP(3) NOT NULL,
    "expected" DECIMAL(18,2) NOT NULL,
    "actual" DECIMAL(18,2) NOT NULL,
    "diff" DECIMAL(18,2) NOT NULL,
    "reason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" INTEGER,
    "voidReason" TEXT,

    CONSTRAINT "cash_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_code_key" ON "payments"("code");

-- CreateIndex
CREATE INDEX "payments_periodId_at_idx" ON "payments"("periodId", "at");

-- CreateIndex
CREATE INDEX "payments_partnerId_idx" ON "payments"("partnerId");

-- CreateIndex
CREATE INDEX "payments_reviewStatus_idx" ON "payments"("reviewStatus");

-- CreateIndex
CREATE INDEX "cash_review_events_docType_docId_idx" ON "cash_review_events"("docType", "docId");

-- CreateIndex
CREATE INDEX "cash_adjustments_docType_docId_idx" ON "cash_adjustments"("docType", "docId");

-- CreateIndex
CREATE INDEX "cash_adjustments_status_idx" ON "cash_adjustments"("status");

-- CreateIndex
CREATE INDEX "cash_closes_cashAccountId_closeAt_idx" ON "cash_closes"("cashAccountId", "closeAt");

-- CreateIndex
CREATE INDEX "receipts_reviewStatus_idx" ON "receipts"("reviewStatus");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECK số liệu/trạng thái
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_partner_chk" CHECK (("kind" IN ('TRA_NCC', 'HOAN_KHACH') AND "partnerId" IS NOT NULL) OR ("kind" NOT IN ('TRA_NCC', 'HOAN_KHACH') AND "partnerId" IS NULL));
ALTER TABLE "payments" ADD CONSTRAINT "payments_cancel_chk" CHECK (("isCancelled" AND "cancelledAt" IS NOT NULL) OR (NOT "isCancelled" AND "cancelledAt" IS NULL));
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_partner_chk" CHECK ("partnerId" IS NOT NULL OR "type" = 'KHAC');
ALTER TABLE "cash_review_events" ADD CONSTRAINT "cash_review_events_doc_chk" CHECK ("docType" IN ('RECEIPT', 'PAYMENT') AND "action" IN ('SUBMIT', 'EDIT', 'RESUBMIT', 'REVIEW', 'RETURN', 'CANCEL'));
ALTER TABLE "cash_adjustments" ADD CONSTRAINT "cash_adjustments_doc_chk" CHECK ("docType" IN ('RECEIPT', 'PAYMENT'));
ALTER TABLE "cash_adjustments" ADD CONSTRAINT "cash_adjustments_kind_chk" CHECK (("kind" = 'VOID' AND "newAmount" IS NULL AND "newCashAccountId" IS NULL) OR ("kind" = 'AMOUNT' AND ("newAmount" IS NOT NULL OR "newCashAccountId" IS NOT NULL) AND ("newAmount" IS NULL OR "newAmount" > 0)));
ALTER TABLE "cash_adjustments" ADD CONSTRAINT "cash_adjustments_decided_chk" CHECK (("status" = 'REQUESTED' AND "decidedBy" IS NULL AND "decidedAt" IS NULL) OR ("status" <> 'REQUESTED' AND "decidedBy" IS NOT NULL AND "decidedAt" IS NOT NULL));
-- Mỗi phiếu chỉ có MỘT yêu cầu điều chỉnh đang chờ
CREATE UNIQUE INDEX "cash_adjustments_open_uq" ON "cash_adjustments"("docType", "docId") WHERE "status" = 'REQUESTED';
ALTER TABLE "cash_closes" ADD CONSTRAINT "cash_closes_chk" CHECK ("actual" >= 0 AND "diff" = "actual" - "expected" AND ("diff" = 0 OR "reason" IS NOT NULL));

-- Backfill: phiếu cọc (C5) đã lập trước khi có sổ quỹ → dựng dòng cash_ledger (chạy lại an toàn: bỏ qua phiếu đã có dòng)
INSERT INTO "cash_ledger" ("periodId", "cashAccountId", "amountIn", "amountOut", "docType", "docId", "at", "createdBy")
SELECT r."periodId", r."cashAccountId", r."amount", 0, 'RECEIPT', r."id", r."at", r."createdBy"
FROM "receipts" r
WHERE NOT r."isCancelled"
  AND NOT EXISTS (SELECT 1 FROM "cash_ledger" c WHERE c."docType" = 'RECEIPT' AND c."docId" = r."id");

-- Quyền cash.* (D-34): tạo dòng quyền TẠI ĐÂY (seed chạy SAU migrate và chỉ cấp quyền cho Giám đốc khi quyền MỚI tạo,
-- nên phải cấp cho Giám đốc luôn) rồi cấp cho vai trò mẫu ĐÃ CÓ — chỉ THÊM, không gỡ.
INSERT INTO "permissions" ("code", "label", "groupName", "isSensitive") VALUES
  ('cash.transaction.create', 'Lập phiếu thu/chi', 'Quỹ', false),
  ('cash.transaction.edit_pending', 'Sửa/hủy phiếu thu/chi chưa kiểm tra', 'Quỹ', false),
  ('cash.review', 'Kiểm tra / trả lại phiếu thu-chi', 'Quỹ', true),
  ('cash.adjust.request', 'Yêu cầu điều chỉnh phiếu đã kiểm tra', 'Quỹ', false),
  ('cash.adjust.approve', 'Duyệt điều chỉnh phiếu đã kiểm tra', 'Quỹ', true),
  ('cash.close', 'Chốt quỹ', 'Quỹ', true),
  ('cash.close.reopen', 'Hủy chốt quỹ', 'Quỹ', true)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
JOIN "permissions" p ON
  (r.name = 'Giám đốc' AND p.code LIKE 'cash.%')
  OR (r.name = 'Kế toán' AND p.code IN ('cash.transaction.create', 'cash.transaction.edit_pending', 'cash.adjust.request'))
  OR (r.name = 'Thủ quỹ' AND p.code IN ('cash.transaction.create', 'cash.transaction.edit_pending', 'cash.review', 'cash.adjust.request', 'cash.adjust.approve', 'cash.close'))
ON CONFLICT DO NOTHING;

-- >>> prisma/migrations/20260930235000_operating_expenses/migration.sql
-- CreateTable
CREATE TABLE "operating_expenses" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "expenseTypeId" INTEGER NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operating_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operating_expenses_paymentId_key" ON "operating_expenses"("paymentId");

-- CreateIndex
CREATE INDEX "operating_expenses_periodId_expenseTypeId_idx" ON "operating_expenses"("periodId", "expenseTypeId");

-- AddForeignKey
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_expenseTypeId_fkey" FOREIGN KEY ("expenseTypeId") REFERENCES "expense_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operating_expenses" ADD CONSTRAINT "operating_expenses_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- >>> prisma/migrations/20261001000000_discount_settlements/migration.sql
-- CreateTable
CREATE TABLE "discount_settlements" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "method" "discount_settle_method" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "paymentId" INTEGER,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_settlements_code_key" ON "discount_settlements"("code");

-- CreateIndex
CREATE UNIQUE INDEX "discount_settlements_paymentId_key" ON "discount_settlements"("paymentId");

-- CreateIndex
CREATE INDEX "discount_settlements_periodId_at_idx" ON "discount_settlements"("periodId", "at");

-- CreateIndex
CREATE INDEX "discount_settlements_partnerId_idx" ON "discount_settlements"("partnerId");

-- AddForeignKey
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECK số liệu/trạng thái: tiền mặt ⇔ có phiếu chi; trừ nợ ⇔ không có phiếu chi
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_amount_chk" CHECK ("amount" > 0);
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_method_chk" CHECK (("method" = 'CASH' AND "paymentId" IS NOT NULL) OR ("method" = 'OFFSET' AND "paymentId" IS NULL));
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_cancel_chk" CHECK (("isCancelled" AND "cancelledAt" IS NOT NULL) OR (NOT "isCancelled" AND "cancelledAt" IS NULL));

-- >>> prisma/migrations/20261001030000_trips/migration.sql
-- CreateEnum
CREATE TYPE "trip_status" AS ENUM ('PLANNED', 'ON_ROAD', 'RETURNED', 'SETTLED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "trip_result_kind" AS ENUM ('GIAO_DU', 'GHI_NO', 'HEN_TRA', 'KHONG_GIAO', 'GIAO_MOT_PHAN');

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "tripId" INTEGER;

-- CreateTable
CREATE TABLE "trips" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "tripDate" TIMESTAMP(3) NOT NULL,
    "routeId" INTEGER,
    "vehicleId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "assistantId" INTEGER,
    "note" TEXT,
    "status" "trip_status" NOT NULL DEFAULT 'PLANNED',
    "departedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "settledBy" INTEGER,
    "expectedAmount" DECIMAL(18,2),
    "cashAmount" DECIMAL(18,2),
    "transferAmount" DECIMAL(18,2),
    "debtAmount" DECIMAL(18,2),
    "diffAmount" DECIMAL(18,2),
    "diffReason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" INTEGER,
    "cashAccountId" INTEGER,
    "transferAccountId" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_orders" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL,
    "result" "trip_result_kind",
    "dueAmount" DECIMAL(18,2),
    "cashAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "transferAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "debtAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "promiseDate" TIMESTAMP(3),
    "resultNote" TEXT,
    "deliveryNoteId" INTEGER,
    "resultAt" TIMESTAMP(3),
    "resultBy" INTEGER,
    "handledAt" TIMESTAMP(3),
    "handledBy" INTEGER,
    "handledNote" TEXT,

    CONSTRAINT "trip_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trips_code_key" ON "trips"("code");

-- CreateIndex
CREATE INDEX "trips_periodId_tripDate_idx" ON "trips"("periodId", "tripDate");

-- CreateIndex
CREATE INDEX "trips_status_idx" ON "trips"("status");

-- CreateIndex
CREATE INDEX "trips_vehicleId_tripDate_idx" ON "trips"("vehicleId", "tripDate");

-- CreateIndex
CREATE UNIQUE INDEX "trip_orders_deliveryNoteId_key" ON "trip_orders"("deliveryNoteId");

-- CreateIndex
CREATE INDEX "trip_orders_orderId_idx" ON "trip_orders"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "trip_orders_tripId_orderId_key" ON "trip_orders"("tripId", "orderId");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_assistantId_fkey" FOREIGN KEY ("assistantId") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_orders" ADD CONSTRAINT "trip_orders_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_orders" ADD CONSTRAINT "trip_orders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sale_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_orders" ADD CONSTRAINT "trip_orders_deliveryNoteId_fkey" FOREIGN KEY ("deliveryNoteId") REFERENCES "delivery_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECK số liệu/trạng thái
ALTER TABLE "trip_orders" ADD CONSTRAINT "trip_orders_amounts_chk" CHECK ("cashAmount" >= 0 AND "transferAmount" >= 0 AND "debtAmount" >= 0 AND ("dueAmount" IS NULL OR "dueAmount" >= 0));
ALTER TABLE "trip_orders" ADD CONSTRAINT "trip_orders_result_chk" CHECK (("result" IS NULL AND "resultAt" IS NULL AND "cashAmount" = 0 AND "transferAmount" = 0 AND "debtAmount" = 0) OR ("result" IS NOT NULL AND "resultAt" IS NOT NULL));
ALTER TABLE "trip_orders" ADD CONSTRAINT "trip_orders_promise_chk" CHECK ("promiseDate" IS NULL OR "result" = 'HEN_TRA');
ALTER TABLE "trips" ADD CONSTRAINT "trips_cancel_chk" CHECK (("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL) OR ("status" <> 'CANCELLED' AND "cancelledAt" IS NULL));
ALTER TABLE "trips" ADD CONSTRAINT "trips_settle_chk" CHECK ("status" NOT IN ('SETTLED', 'CONFIRMED') OR ("settledAt" IS NOT NULL AND "expectedAmount" IS NOT NULL AND "diffAmount" IS NOT NULL AND ("diffAmount" = 0 OR "diffReason" IS NOT NULL)));
ALTER TABLE "trips" ADD CONSTRAINT "trips_confirm_chk" CHECK ("status" <> 'CONFIRMED' OR ("confirmedAt" IS NOT NULL AND "confirmedBy" IS NOT NULL));

-- Quyền trip.* chưa gán cho vai trò nào ở bản trước → cấp cho vai trò mẫu đã có (chỉ THÊM):
-- Kế toán có sẵn trip.manage/trip.settle từ danh mục gốc; Thủ quỹ có trip.confirm_cash. Bổ sung Thủ quỹ đối soát (trip.settle).
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id FROM "roles" r JOIN "permissions" p ON r.name = 'Thủ quỹ' AND p.code IN ('trip.settle')
ON CONFLICT DO NOTHING;

-- >>> prisma/migrations/20261001060000_print_files/migration.sql
-- CreateTable
CREATE TABLE "print_files" (
    "id" SERIAL NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" INTEGER NOT NULL,
    "templateId" INTEGER,
    "fileId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "printedBy" INTEGER NOT NULL,
    "printedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "print_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "print_files_docType_docId_key" ON "print_files"("docType", "docId");


-- CHECK: URL bản in phải là https
ALTER TABLE "print_files" ADD CONSTRAINT "print_files_url_chk" CHECK ("url" LIKE 'https://%');

-- >>> prisma/migrations/20261002000000_production_orders/migration.sql
-- Plan 06-E1: lệnh sản xuất phụ kiện
CREATE TABLE "production_orders" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "outSeq" BIGINT,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "production_materials" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "materialProductId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "seq" BIGINT,
    CONSTRAINT "production_materials_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "production_orders_code_key" ON "production_orders"("code");
-- CreateIndex
CREATE INDEX "production_orders_periodId_at_idx" ON "production_orders"("periodId", "at");
-- CreateIndex
CREATE UNIQUE INDEX "production_materials_orderId_materialProductId_key" ON "production_materials"("orderId", "materialProductId");
-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "production_materials" ADD CONSTRAINT "production_materials_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "production_materials" ADD CONSTRAINT "production_materials_materialProductId_fkey" FOREIGN KEY ("materialProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Số liệu hợp lệ
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_qty_chk" CHECK ("qty" > 0);
ALTER TABLE "production_materials" ADD CONSTRAINT "production_materials_qty_chk" CHECK ("qty" > 0);

-- >>> prisma/migrations/20261002010000_stocktakes/migration.sql
-- Plan 06-E4: kiểm kho
-- CreateEnum
CREATE TYPE "stocktake_status" AS ENUM ('DRAFT', 'DONE', 'CANCELLED');
-- CreateTable
CREATE TABLE "stocktakes" (
    "id" SERIAL NOT NULL,
    "periodId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "status" "stocktake_status" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "confirmedBy" INTEGER,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" INTEGER,
    "cancelReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stocktakes_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "stocktake_lines" (
    "id" SERIAL NOT NULL,
    "stocktakeId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "actualQty" DECIMAL(18,3) NOT NULL,
    "systemQty" DECIMAL(18,3),
    "diff" DECIMAL(18,3),
    "unitCost" DECIMAL(18,4),
    "seq" BIGINT,
    CONSTRAINT "stocktake_lines_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "stocktakes_code_key" ON "stocktakes"("code");
-- CreateIndex
CREATE INDEX "stocktakes_periodId_at_idx" ON "stocktakes"("periodId", "at");
-- CreateIndex
CREATE INDEX "stocktakes_periodId_status_idx" ON "stocktakes"("periodId", "status");
-- CreateIndex
CREATE UNIQUE INDEX "stocktake_lines_stocktakeId_productId_key" ON "stocktake_lines"("stocktakeId", "productId");
-- AddForeignKey
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "stocktakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stocktake_lines" ADD CONSTRAINT "stocktake_lines_actual_chk" CHECK ("actualQty" >= 0);
-- Đã chốt (DONE) thì phải có đủ số liệu chốt; chưa chốt thì chưa có
ALTER TABLE "stocktakes" ADD CONSTRAINT "stocktakes_confirm_chk" CHECK (("status" = 'DONE') = ("confirmedAt" IS NOT NULL) OR "status" = 'CANCELLED');

-- >>> prisma/migrations/20261002100000_user_preferences/migration.sql
-- Cấu hình giao diện theo tài khoản (module tabs). Chỉ thêm bảng, không đụng dữ liệu cũ.
-- CreateTable
CREATE TABLE "user_preferences" (
    "userId" INTEGER NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- >>> prisma/migrations/20261005000000_sale_order_extras/migration.sql
-- Đơn bán: người bán, kho xuất, hình thức thanh toán dự kiến; sản phẩm: ảnh minh hoạ. Chỉ thêm cột (nullable/default) — không đụng dữ liệu cũ.
CREATE TYPE "sale_payment_method" AS ENUM ('NONE', 'CASH', 'TRANSFER', 'COD');

ALTER TABLE "sale_orders" ADD COLUMN "salesUserId" INTEGER,
ADD COLUMN "warehouseId" INTEGER,
ADD COLUMN "paymentMethod" "sale_payment_method" NOT NULL DEFAULT 'NONE';

ALTER TABLE "products" ADD COLUMN "imageUrl" TEXT;

ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_salesUserId_fkey" FOREIGN KEY ("salesUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- >>> prisma/migrations/20261005100000_sale_checkout_walkin/migration.sql
-- Bán lẻ tại quầy: khách lẻ ghi tên/SĐT trên đơn; khách hàng có MST và địa chỉ giao hàng. Chỉ thêm cột nullable.
ALTER TABLE "partners" ADD COLUMN "taxCode" TEXT,
ADD COLUMN "deliveryAddress" TEXT;

ALTER TABLE "sale_orders" ADD COLUMN "walkInName" TEXT,
ADD COLUMN "walkInPhone" TEXT;

-- >>> prisma/migrations/20261005200000_sale_shipping_discount_note/migration.sql
-- Phí vận chuyển + chiết khấu cả đơn (đã phân bổ vào dòng) + ghi chú theo dòng. Chỉ thêm cột có mặc định.
ALTER TABLE "sale_orders" ADD COLUMN "shippingFee" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN "orderDiscount" DECIMAL(18,2) NOT NULL DEFAULT 0;

ALTER TABLE "sale_order_lines" ADD COLUMN "discountOrder" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN "note" TEXT;

ALTER TABLE "sale_orders" ADD CONSTRAINT "sale_orders_shipping_discount_chk" CHECK ("shippingFee" >= 0 AND "orderDiscount" >= 0);
ALTER TABLE "sale_order_lines" ADD CONSTRAINT "sale_order_lines_discount_order_chk" CHECK ("discountOrder" >= 0 AND "discountOrder" <= "discountNow");

-- >>> prisma/migrations/20261005300000_product_groups/migration.sql
-- Nhóm hàng của sản phẩm (tuỳ chọn). Chỉ thêm bảng + cột nullable.
CREATE TABLE "product_groups" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_groups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_groups_name_key" ON "product_groups"("name");

ALTER TABLE "products" ADD COLUMN "groupId" INTEGER;

CREATE INDEX "products_groupId_idx" ON "products"("groupId");

ALTER TABLE "products" ADD CONSTRAINT "products_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "product_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- app_rw: cùng quyền như các bảng danh mục khác (idempotent)
GRANT SELECT, INSERT, UPDATE, DELETE ON "product_groups" TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE "product_groups_id_seq" TO app_rw;

-- >>> prisma/migrations/20261006100000_return_refund_deduction/migration.sql
-- Trả hàng của khách: khoản khấu trừ (phí vận chuyển/khác) + liên kết phiếu hoàn tiền (HOAN_KHACH) sinh cùng phiếu trả. Chỉ thêm cột.
ALTER TABLE "goods_returns" ADD COLUMN "deductionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN "deductionNote" TEXT;
ALTER TABLE "goods_returns" ADD CONSTRAINT "goods_returns_deduction_chk" CHECK ("deductionAmount" >= 0 AND "deductionAmount" <= "totalAmount");

ALTER TABLE "payments" ADD COLUMN "goodsReturnId" INTEGER;
ALTER TABLE "payments" ADD CONSTRAINT "payments_goodsReturnId_fkey" FOREIGN KEY ("goodsReturnId") REFERENCES "goods_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "payments_goodsReturnId_idx" ON "payments"("goodsReturnId");

-- >>> prisma/migrations/20261006200000_opening_demo_flag/migration.sql
-- Cờ "số demo" cho số đầu kỳ (nạp tạm để test, reset khi chạy chính thức). Chỉ thêm cột có mặc định.
ALTER TABLE "opening_stock" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "opening_debt" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "opening_cash" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "opening_discount" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- >>> prisma/migrations/20261007100000_bom_area_ratio/migration.sql
-- Tỷ lệ m²/md của định mức (bán tôn gia công theo kích thước). Chỉ thêm cột nullable.
ALTER TABLE "boms" ADD COLUMN "areaRatio" DECIMAL(18,4);
ALTER TABLE "boms" ADD CONSTRAINT "boms_areaRatio_positive" CHECK ("areaRatio" IS NULL OR "areaRatio" > 0);

-- >>> prisma/migrations/20261007200000_product_processing_ratios/migration.sql
-- Tỷ lệ m²/md theo (sản phẩm × kiểu gia công), không phụ thuộc định mức. Chuyển dữ liệu từ boms.areaRatio rồi bỏ cột.
CREATE TABLE "product_processing_ratios" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "processingTypeId" INTEGER NOT NULL,
    "ratio" DECIMAL(18,4) NOT NULL,
    "updatedBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_processing_ratios_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_processing_ratios_ratio_positive" CHECK ("ratio" > 0)
);
CREATE UNIQUE INDEX "product_processing_ratios_productId_processingTypeId_key" ON "product_processing_ratios"("productId", "processingTypeId");
ALTER TABLE "product_processing_ratios" ADD CONSTRAINT "product_processing_ratios_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_processing_ratios" ADD CONSTRAINT "product_processing_ratios_processingTypeId_fkey" FOREIGN KEY ("processingTypeId") REFERENCES "processing_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "product_processing_ratios" ("productId", "processingTypeId", "ratio", "updatedBy", "updatedAt")
SELECT "productId", "processingTypeId", "areaRatio", "createdBy", CURRENT_TIMESTAMP FROM "boms" WHERE "areaRatio" IS NOT NULL;

ALTER TABLE "boms" DROP COLUMN "areaRatio";

GRANT SELECT, INSERT, UPDATE, DELETE ON "product_processing_ratios" TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE "product_processing_ratios_id_seq" TO app_rw;

-- >>> prisma/migrations/20261008100000_partner_extra_fields/migration.sql
-- Thông tin bổ sung của đối tác (tuỳ chọn): email, TK ngân hàng, người đại diện, thứ tự, loại "Chi phí".
ALTER TABLE "partners" ADD COLUMN "email" TEXT;
ALTER TABLE "partners" ADD COLUMN "bankAccount" TEXT;
ALTER TABLE "partners" ADD COLUMN "representative" TEXT;
ALTER TABLE "partners" ADD COLUMN "sortOrder" INTEGER;
ALTER TABLE "partners" ADD COLUMN "isExpense" BOOLEAN NOT NULL DEFAULT false;

-- >>> prisma/migrations/20261009100000_processing_type_ratio/migration.sql
-- Kiểu gia công: tỷ lệ m²/md mặc định, tỷ lệ trừ kho, ĐVT thành cột thật (trước đây chỉ là chữ trong Ghi chú).
ALTER TABLE "processing_types" ADD COLUMN "ratio" DECIMAL(18,4), ADD COLUMN "stockRatio" DECIMAL(18,4), ADD COLUMN "unit" TEXT;

-- Chép số từ Ghi chú dạng "Tỷ lệ 1,08 · Trừ kho 1 · ĐVT m2" (số kiểu VN: phẩy thập phân). Dòng không đọc được giữ nguyên Ghi chú, cột để trống.
UPDATE "processing_types" SET "ratio" = replace((regexp_match("note", 'Tỷ lệ ([0-9]+(?:,[0-9]+)?)'))[1], ',', '.')::numeric WHERE "note" ~ 'Tỷ lệ [0-9]+(,[0-9]+)?( |$|·|\()' ;
UPDATE "processing_types" SET "stockRatio" = replace((regexp_match("note", 'Trừ kho ([0-9]+(?:,[0-9]+)?)'))[1], ',', '.')::numeric WHERE "note" ~ 'Trừ kho [0-9]+(,[0-9]+)?( |$|·)';
UPDATE "processing_types" SET "unit" = (regexp_match("note", 'ĐVT ([^ ·]+)'))[1] WHERE "note" ~ 'ĐVT [^ ·]+';
UPDATE "processing_types" SET "ratio" = NULL WHERE "ratio" <= 0 OR "ratio" > 1000000;
UPDATE "processing_types" SET "stockRatio" = NULL WHERE "stockRatio" <= 0 OR "stockRatio" > 1000000;

-- Bỏ phần đã chép khỏi Ghi chú (chỉ khi cột tương ứng đã có giá trị).
UPDATE "processing_types" SET "note" = NULLIF(btrim(regexp_replace("note", '\s*(—\s*)?Tỷ lệ [0-9]+(,[0-9]+)?( m2| m)?( \(theo sản phẩm đầu tiên dùng kiểu này\))?', ''), E' ·—'), '') WHERE "ratio" IS NOT NULL;
UPDATE "processing_types" SET "note" = NULLIF(btrim(regexp_replace("note", '\s*·?\s*Trừ kho [0-9]+(,[0-9]+)?', ''), E' ·—'), '') WHERE "stockRatio" IS NOT NULL;
UPDATE "processing_types" SET "note" = NULLIF(btrim(regexp_replace("note", '\s*·?\s*ĐVT [^ ·]+', ''), E' ·—'), '') WHERE "unit" IS NOT NULL;

ALTER TABLE "processing_types" ADD CONSTRAINT "processing_types_ratio_positive" CHECK ("ratio" IS NULL OR "ratio" > 0), ADD CONSTRAINT "processing_types_stockRatio_positive" CHECK ("stockRatio" IS NULL OR "stockRatio" > 0);

-- >>> prisma/migrations/20261010100000_product_processing_links/migration.sql
-- Gắn kiểu gia công cho từng sản phẩm: một dòng (sản phẩm × kiểu) = sản phẩm có kiểu đó; ratio NULL = dùng tỷ lệ mặc định của kiểu.
-- Dòng đang có (tỷ lệ đã khai báo) mặc nhiên là đã gắn.
ALTER TABLE "product_processing_ratios" ALTER COLUMN "ratio" DROP NOT NULL;

-- >>> prisma/migrations/20261011100000_product_prices_units/migration.sql
-- Danh mục đơn vị tính (nạp sẵn từ đơn vị đang dùng) + giá/đơn vị/thông tin bổ sung của sản phẩm. Chỉ thêm bảng/cột nullable.
CREATE TABLE "units" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "units_name_key" ON "units"("name");

INSERT INTO "units" ("name")
SELECT DISTINCT TRIM(u) FROM (
    SELECT "baseUnit" AS u FROM "products"
    UNION SELECT "unit" FROM "product_units"
) x WHERE TRIM(u) <> ''
ON CONFLICT DO NOTHING;

ALTER TABLE "products"
    ADD COLUMN "purchasePrice" DECIMAL(18,2),
    ADD COLUMN "salePrice" DECIMAL(18,2),
    ADD COLUMN "importUnit" TEXT,
    ADD COLUMN "exportUnit" TEXT,
    ADD COLUMN "bundleQty" DECIMAL(18,3),
    ADD COLUMN "qtyLabel" TEXT,
    ADD CONSTRAINT "products_prices_nonneg" CHECK (("purchasePrice" IS NULL OR "purchasePrice" >= 0) AND ("salePrice" IS NULL OR "salePrice" >= 0) AND ("bundleQty" IS NULL OR "bundleQty" > 0));

GRANT SELECT, INSERT, UPDATE, DELETE ON "units" TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE "units_id_seq" TO app_rw;

-- >>> prisma/migrations/20261011200000_purchase_line_processing/migration.sql
-- Kiểu gia công của dòng phiếu nhập (tuỳ chọn, chỉ ghi nhận). Chỉ thêm cột nullable + FK.
ALTER TABLE "purchase_lines" ADD COLUMN "processingTypeId" INTEGER;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_processingTypeId_fkey" FOREIGN KEY ("processingTypeId") REFERENCES "processing_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "purchase_lines_processingTypeId_idx" ON "purchase_lines"("processingTypeId");

-- >>> prisma/migrations/20261012100000_quote_line_processing/migration.sql
-- Kiểu gia công của dòng báo giá (tuỳ chọn). Chỉ thêm cột nullable + FK.
ALTER TABLE "quote_lines" ADD COLUMN "processingTypeId" INTEGER;
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_processingTypeId_fkey" FOREIGN KEY ("processingTypeId") REFERENCES "processing_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "quote_lines_processingTypeId_idx" ON "quote_lines"("processingTypeId");

-- >>> prisma/migrations/20261012200000_processing_price_basis/migration.sql
-- Cách tính giá của kiểu gia công: mét dài (mặc định, giữ hành vi cũ) hoặc mét vuông. Chỉ thêm kiểu + cột có DEFAULT.
CREATE TYPE "PriceBasis" AS ENUM ('LENGTH', 'AREA');
ALTER TABLE "processing_types" ADD COLUMN "priceBasis" "PriceBasis" NOT NULL DEFAULT 'LENGTH';

-- >>> prisma/migrations/20261012300000_price_basis_unit/migration.sql
-- Kiểu gia công bán theo đúng ĐVT riêng (kg, bình, cây…). Chỉ thêm giá trị enum, không đụng dữ liệu.
ALTER TYPE "PriceBasis" ADD VALUE 'UNIT';

-- >>> prisma/migrations/20261013100000_return_undelivered/migration.sql
-- Phiếu trả hàng chưa giao (hàng không giao được trả về kho): chỉ thêm cột có mặc định.
ALTER TABLE "goods_returns" ADD COLUMN "undelivered" BOOLEAN NOT NULL DEFAULT false;

-- >>> prisma/migrations/20261013200000_trip_discount_over/migration.sql
-- Tiền bớt và phần thu vượt tại điểm giao (chuyến): chỉ thêm cột có mặc định 0.
ALTER TABLE "trip_orders" ADD COLUMN "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0, ADD COLUMN "overAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- >>> prisma/migrations/20261015110000_daily_reviews/migration.sql
CREATE TABLE "daily_reviews" (
  "userId" INTEGER NOT NULL,
  "day" DATE NOT NULL,
  "itemKey" TEXT NOT NULL,
  "seenAt" TIMESTAMP(3),
  "seenVersion" TEXT,
  "checkedAt" TIMESTAMP(3),
  "checkedVersion" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_reviews_pkey" PRIMARY KEY ("userId", "day", "itemKey"),
  CONSTRAINT "daily_reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "daily_reviews_item_key_chk" CHECK ("itemKey" IN ('return-order','return-product','return-supplier','undelivered','loss','debt','discount-orders','settlements','receipts','payments','purchases')),
  CONSTRAINT "daily_reviews_seen_pair_chk" CHECK (("seenAt" IS NULL) = ("seenVersion" IS NULL)),
  CONSTRAINT "daily_reviews_checked_pair_chk" CHECK (("checkedAt" IS NULL) = ("checkedVersion" IS NULL))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON "daily_reviews" TO app_rw;

-- >>> prisma/migrations/20261016090000_product_capabilities/migration.sql
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

-- >>> prisma/migrations/20261016120000_trip_stop_accounts/migration.sql
-- Quỹ tiền mặt / tài khoản ngân hàng nhận tiền theo từng điểm giao (mỗi đơn có thể vào quỹ/STK khác nhau).
ALTER TABLE "trip_orders"
  ADD COLUMN "cashAccountId" INTEGER,
  ADD COLUMN "transferAccountId" INTEGER;

-- >>> prisma/migrations/20261016150000_regular_retail/migration.sql
-- Khách lẻ thân quen: hồ sơ nhẹ (tên + SĐT), không công nợ. Chỉ thêm cột.
ALTER TABLE "partners"
  ADD COLUMN "isRegularRetail" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "phoneKey" TEXT;
CREATE UNIQUE INDEX "partners_phoneKey_key" ON "partners"("phoneKey");
ALTER TABLE "partners" ADD CONSTRAINT "partners_regular_retail_nocredit"
  CHECK ("isRegularRetail" = false OR ("allowCredit" = false AND "debtLimit" = 0));

-- >>> prisma/migrations/20261016170000_discount_forfeit/migration.sql
-- Tất toán chiết khấu: thêm hình thức "chuyển vào lãi công ty" (không chi tiền, không trừ công nợ). Chỉ thêm giá trị enum.
ALTER TYPE "discount_settle_method" ADD VALUE 'FORFEIT';

-- >>> prisma/migrations/20261016170100_discount_forfeit_check/migration.sql
-- Tách khỏi migration thêm giá trị enum (Postgres không cho dùng giá trị enum mới trong cùng giao dịch).
-- Tiền mặt ⇔ có phiếu chi; trừ nợ / chuyển vào lãi công ty ⇔ không có phiếu chi.
ALTER TABLE "discount_settlements" DROP CONSTRAINT "discount_settlements_method_chk";
ALTER TABLE "discount_settlements" ADD CONSTRAINT "discount_settlements_method_chk" CHECK (("method" = 'CASH' AND "paymentId" IS NOT NULL) OR ("method" IN ('OFFSET', 'FORFEIT') AND "paymentId" IS NULL));

-- >>> prisma/migrations/20261017100000_supplier_orders/migration.sql
-- AlterTable
ALTER TABLE "purchase_lines" ADD COLUMN     "supplierOrderLineId" INTEGER;

-- CreateTable
CREATE TABLE "supplier_orders" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "note" TEXT NOT NULL DEFAULT '',
    "closeReason" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_order_lines" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "qty" DECIMAL(18,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "factor" DECIMAL(18,6) NOT NULL,
    "purchasePrice" DECIMAL(18,2) NOT NULL,
    "expectedDate" DATE,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "supplier_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_order_notices" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "purchaseId" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_order_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_orders_code_key" ON "supplier_orders"("code");

-- CreateIndex
CREATE INDEX "supplier_orders_state_date_idx" ON "supplier_orders"("state", "date");

-- CreateIndex
CREATE INDEX "supplier_orders_createdBy_date_idx" ON "supplier_orders"("createdBy", "date");

-- CreateIndex
CREATE INDEX "supplier_orders_partnerId_date_idx" ON "supplier_orders"("partnerId", "date");

-- CreateIndex
CREATE INDEX "supplier_order_lines_orderId_idx" ON "supplier_order_lines"("orderId");

-- CreateIndex
CREATE INDEX "supplier_order_lines_productId_idx" ON "supplier_order_lines"("productId");

-- CreateIndex
CREATE INDEX "supplier_order_notices_userId_readAt_createdAt_idx" ON "supplier_order_notices"("userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_supplierOrderLineId_fkey" FOREIGN KEY ("supplierOrderLineId") REFERENCES "supplier_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_lines" ADD CONSTRAINT "supplier_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "supplier_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_lines" ADD CONSTRAINT "supplier_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_notices" ADD CONSTRAINT "supplier_order_notices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_order_notices" ADD CONSTRAINT "supplier_order_notices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "supplier_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE INDEX "purchase_lines_supplierOrderLineId_idx" ON "purchase_lines"("supplierOrderLineId");
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_state_check" CHECK (state IN ('DRAFT','SENT','CLOSED','CANCELLED'));
ALTER TABLE "supplier_order_lines" ADD CONSTRAINT "supplier_order_lines_values_check" CHECK (qty > 0 AND factor > 0 AND "purchasePrice" >= 0);
GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_orders", "supplier_order_lines", "supplier_order_notices" TO app_rw;
GRANT USAGE, SELECT ON SEQUENCE "supplier_orders_id_seq", "supplier_order_lines_id_seq", "supplier_order_notices_id_seq" TO app_rw;

ALTER TABLE "supplier_orders" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "supplier_order_lines" ADD COLUMN "processingTypeId" INTEGER REFERENCES "processing_types"("id") ON DELETE RESTRICT;

-- >>> prisma/migrations/20261017120000_order_analysis_access/migration.sql
-- Sales-only disclosure permission. Keep purchasing permissions intact.
INSERT INTO "permissions" (code, label, "groupName", "isSensitive")
VALUES ('order.analysis.view', 'Xem định mức, giá vốn và lợi nhuận đơn hàng', 'Bán hàng', true)
ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label, "groupName"=EXCLUDED."groupName", "isSensitive"=true;

-- ASSUMPTION: director and existing role administrators are administrative roles.
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT DISTINCT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE p.code='order.analysis.view' AND (r.name='Giám đốc' OR EXISTS (
  SELECT 1 FROM role_permissions rp JOIN permissions a ON a.id=rp."permissionId"
  WHERE rp."roleId"=r.id AND a.code='role.manage'
)) ON CONFLICT DO NOTHING;

-- >>> prisma/migrations/20261018120000_payment_advanced_by/migration.sql
ALTER TABLE "payments" ADD COLUMN "advancedById" INTEGER;
ALTER TABLE "payments" ADD CONSTRAINT "payments_advancedById_fkey"
  FOREIGN KEY ("advancedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- >>> prisma/migrations/20261018180000_reference_cost_plans/migration.sql
CREATE TABLE "reference_cost_plans" (
  "id" SERIAL PRIMARY KEY,
  "productId" INTEGER REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "processingTypeId" INTEGER NOT NULL REFERENCES "processing_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "validFrom" DATE NOT NULL,
  "tonProductId" INTEGER REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "fixedPricePerM2" DECIMAL(18,4),
  "tonQtyPerMeter" DECIMAL(18,6) NOT NULL DEFAULT 1,
  "feePerMeter" DECIMAL(18,4),
  "note" TEXT,
  "createdBy" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reference_cost_amounts_check" CHECK (
    ("fixedPricePerM2" IS NULL OR "fixedPricePerM2" >= 0) AND
    ("feePerMeter" IS NULL OR "feePerMeter" >= 0) AND "tonQtyPerMeter" > 0),
  CONSTRAINT "reference_cost_scope_check" CHECK (
    ("productId" IS NULL AND "tonProductId" IS NULL AND "fixedPricePerM2" IS NULL AND "feePerMeter" IS NOT NULL) OR
    ("productId" IS NOT NULL AND "tonProductId" IS NOT NULL))
);
CREATE UNIQUE INDEX "reference_cost_plans_productId_processingTypeId_validFrom_key"
 ON "reference_cost_plans"("productId", "processingTypeId", "validFrom");
CREATE UNIQUE INDEX "reference_cost_default_date_key" ON "reference_cost_plans"("processingTypeId", "validFrom") WHERE "productId" IS NULL;
CREATE INDEX "reference_cost_plans_processingTypeId_validFrom_idx" ON "reference_cost_plans"("processingTypeId", "validFrom");
ALTER TABLE "sale_order_lines" ADD COLUMN "referenceCostSnapshot" JSONB;

-- >>> prisma/migrations/20261019120000_production_multi_output/migration.sql
ALTER TABLE production_orders ADD COLUMN "allocationBasis" TEXT NOT NULL DEFAULT 'WEIGHT';
ALTER TABLE production_materials ADD COLUMN "widthMm" DECIMAL(18,3);
ALTER TABLE cost_layers ADD COLUMN "costRefShare" DECIMAL(18,12) NOT NULL DEFAULT 1;
ALTER TABLE cost_layers ADD CONSTRAINT cost_layers_share_check CHECK ("costRefShare" > 0 AND "costRefShare" <= 1);
CREATE TABLE production_outputs (
 id SERIAL PRIMARY KEY,
 "orderId" INTEGER NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE ON UPDATE CASCADE,
 "productId" INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 qty DECIMAL(18,3) NOT NULL CHECK (qty > 0),
 "widthMm" DECIMAL(18,3),
 "stripCount" INTEGER NOT NULL DEFAULT 1 CHECK ("stripCount" > 0),
 "lengthM" DECIMAL(18,3),
 "allocationWeight" DECIMAL(18,3) NOT NULL CHECK ("allocationWeight" > 0),
 seq BIGINT,
 CONSTRAINT "production_outputs_orderId_productId_key" UNIQUE ("orderId", "productId")
);
CREATE INDEX "production_outputs_productId_idx" ON production_outputs("productId");
-- Backfill historical outputs without changing their ledger references or sequence.
INSERT INTO production_outputs ("orderId", "productId", qty, "allocationWeight", seq)
SELECT id, "productId", qty, 1, "outSeq" FROM production_orders;

-- >>> prisma/migrations/20261020120000_sale_cost_hint/migration.sql
-- Con số giá vốn tham khảo (không chi tiết) cho màn bán hàng của kế toán, kèm cảnh báo bán dưới vốn.
INSERT INTO "permissions" (code, label, "groupName", "isSensitive")
VALUES ('sale.cost_hint.view', 'Xem giá vốn tham khảo khi bán (không chi tiết)', 'Bán hàng', true)
ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label, "groupName"=EXCLUDED."groupName", "isSensitive"=true;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE p.code='sale.cost_hint.view' AND r.name='Kế toán'
ON CONFLICT DO NOTHING;

-- >>> prisma/migrations/20261021120000_cash_top_up/migration.sql
-- Phiếu thu "Bổ sung quỹ": tiền giám đốc đưa thêm vào quỹ tiền mặt trong ngày (không gắn khách, không công nợ).
ALTER TYPE "receipt_type" ADD VALUE IF NOT EXISTS 'BO_SUNG_QUY';

-- >>> prisma/migrations/20261021120100_cash_top_up_constraint/migration.sql
-- Tách file riêng: giá trị enum mới chỉ dùng được sau khi migration thêm giá trị đã commit.
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_partner_chk";
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_partner_chk" CHECK ("partnerId" IS NOT NULL OR "type" IN ('KHAC', 'BO_SUNG_QUY'));

-- >>> prisma/migrations/20261022120000_cash_hand_over/migration.sql
-- Phiếu chi "Nộp lại quỹ": giám đốc nhận lại tiền quỹ (không gắn đối tác, không công nợ, không tính vào chi phí).
ALTER TYPE "payment_kind" ADD VALUE IF NOT EXISTS 'NOP_LAI_QUY';

-- >>> prisma/migrations/20261023120000_return_line_note/migration.sql
-- Ghi chú dòng phiếu trả (trả theo kích thước ghi dài × tỷ lệ × số tấm). Chỉ thêm cột, dữ liệu cũ để NULL.
ALTER TABLE "goods_return_lines" ADD COLUMN "note" TEXT;

-- >>> prisma/migrations/20261024120000_reference_cost_aux_fixed/migration.sql
-- Vật liệu phụ của dự toán gia công: NULL = giá nhập gần nhất theo BOM (như cũ); có số = giá cố định đ/m dài. Chỉ thêm cột.
ALTER TABLE "reference_cost_plans" ADD COLUMN "auxFixedPerMeter" DECIMAL(18,4);

-- >>> prisma/migrations/20261024130000_grant_cost_hint_director/migration.sql
-- Migration 20261020120000 chỉ cấp sale.cost_hint.view cho "Kế toán" mà quên "Giám đốc" (nhóm giữ mọi quyền).
-- Hệ quả: Giám đốc không cấp lại mật khẩu/khoá/đổi nhóm được tài khoản Kế toán (chống leo thang đặc quyền: quyền đối tượng ⊄ quyền mình).
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE p.code='sale.cost_hint.view' AND r.name='Giám đốc'
ON CONFLICT DO NOTHING;

-- >>> prisma/migrations/20261025100000_product_stock_lanes/migration.sql
CREATE TABLE "product_stock_lanes" (
  "productId" INTEGER NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "processingTypeId" INTEGER NOT NULL REFERENCES "processing_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "stockProductId" INTEGER NOT NULL REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("productId", "processingTypeId")
);
CREATE INDEX "product_stock_lanes_stockProductId_idx" ON "product_stock_lanes"("stockProductId");
