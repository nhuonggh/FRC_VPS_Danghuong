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
