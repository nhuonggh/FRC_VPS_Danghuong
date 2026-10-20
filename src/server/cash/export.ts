import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { buildXlsx } from "@/server/export/xlsx";
import { REVIEW_LABEL, listCashBook } from "./queries";

export async function exportCashBookXlsx(db: PrismaClient, actor: Actor, type: "CASH" | "BANK", accountId: number | null): Promise<Buffer> {
  const book = await listCashBook(db, actor, type, accountId, { page: 1, pageSize: 100_000, filters: {} } as never);
  const name = book.selected?.name ?? "Sổ quỹ";
  return buildXlsx(name.slice(0, 30), [
    { header: "Ngày", key: "at", width: 18 }, { header: "Chứng từ", key: "docCode", width: 16, text: true }, { header: "Loại", key: "docLabel", width: 18 }, { header: "Nội dung thu/chi", key: "content", width: 36 }, { header: "Người nộp/nhận", key: "counterparty", width: 24 }, { header: "Trạng thái kiểm tra", key: "status", width: 18 }, { header: "Người kiểm tra", key: "reviewerName", width: 22 },
    { header: "Thu", key: "amountIn", width: 16, numFmt: "#,##0" }, { header: "Chi", key: "amountOut", width: 16, numFmt: "#,##0" }, { header: "Số dư", key: "running", width: 16, numFmt: "#,##0" },
  ], [...book.entries].reverse().map((e) => ({ ...e, status: e.reviewStatus ? REVIEW_LABEL[e.reviewStatus] : "" })));
}
