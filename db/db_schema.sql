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
