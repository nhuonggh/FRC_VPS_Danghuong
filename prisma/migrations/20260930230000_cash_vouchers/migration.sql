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
