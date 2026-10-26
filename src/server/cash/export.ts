import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { buildXlsx } from "@/server/export/xlsx";
import type { ListParams } from "@/lib/query-params";
import { REVIEW_LABEL, listCashBook } from "./queries";

export async function exportCashBookXlsx(db: PrismaClient, actor: Actor, type: "CASH" | "BANK", accountId: number | null, range: Pick<ListParams, "timePreset" | "timeStart" | "timeEnd"> = {}): Promise<Buffer> {
  const book = await listCashBook(db, actor, type, accountId, { page: 1, pageSize: 100_000, filters: {}, ...range } as never);
  const name = book.selected?.name ?? "Sổ quỹ";
  const entries = [...book.entries].reverse().map((e) => ({ ...e, status: e.reviewStatus ? REVIEW_LABEL[e.reviewStatus] : "" }));
  // Xuất theo ngày: thêm dòng số dư đầu kỳ / cuối kỳ như sổ kế toán.
  const rows = book.rangeOpening === null ? entries : [{ content: "Số dư đầu kỳ", running: book.rangeOpening }, ...entries, { content: "Số dư cuối kỳ", running: entries.at(-1)?.running ?? book.rangeOpening }];
  return buildXlsx(name.slice(0, 30), [
    { header: "Ngày", key: "at", width: 18 }, { header: "Chứng từ", key: "docCode", width: 16, text: true }, { header: "Loại", key: "docLabel", width: 18 }, { header: "Nội dung thu/chi", key: "content", width: 36 }, { header: "Người nộp/nhận", key: "counterparty", width: 24 }, { header: "Trạng thái kiểm tra", key: "status", width: 18 }, { header: "Người kiểm tra", key: "reviewerName", width: 22 },
    { header: "Thu", key: "amountIn", width: 16, numFmt: "#,##0" }, { header: "Chi", key: "amountOut", width: 16, numFmt: "#,##0" }, { header: "Số dư", key: "running", width: 16, numFmt: "#,##0" },
  ], rows);
}
