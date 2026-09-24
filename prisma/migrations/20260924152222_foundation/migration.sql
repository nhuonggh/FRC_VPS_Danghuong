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
