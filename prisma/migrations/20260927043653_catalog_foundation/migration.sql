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
