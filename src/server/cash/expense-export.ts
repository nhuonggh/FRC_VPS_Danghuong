import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { buildXlsx } from "@/server/export/xlsx";
import { REVIEW_LABEL, listExpenses } from "./queries";

export async function exportExpensesXlsx(db: PrismaClient, actor: Actor, params: ListParams): Promise<Buffer> {
  const { rows } = await listExpenses(db, actor, params, { all: true });
  return buildXlsx("Chi phí", [
    { header: "Phiếu chi", key: "code", width: 14, text: true }, { header: "Ngày", key: "at", width: 14 }, { header: "Loại chi phí", key: "expenseTypeName", width: 22 }, { header: "Số tiền", key: "amount", width: 16, numFmt: "#,##0" },
    { header: "Quỹ", key: "cashAccountName", width: 18 }, { header: "Trạng thái", key: "status", width: 16 }, { header: "Ghi chú", key: "note", width: 34 }, { header: "Người lập", key: "createdByName", width: 20 },
  ], rows.map((r) => ({ ...r, status: r.isCancelled ? "Đã hủy" : REVIEW_LABEL[r.reviewStatus] })));
}
