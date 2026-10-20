import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { buildXlsxSheets } from "@/server/export/xlsx";
import { cashReport } from "./report";

const money = (key: string, header: string, width = 16) => ({ header, key, width, numFmt: "#,##0" });

/** Excel báo cáo quỹ: sheet "Theo ngày" và sheet "Theo người kiểm tra" (cùng số liệu với màn hình). */
export async function exportCashReportXlsx(db: PrismaClient, actor: Actor, accountId: number | null, params: ListParams): Promise<Buffer> {
  const r = await cashReport(db, actor, accountId, params);
  return buildXlsxSheets([
    {
      name: "Theo ngày",
      columns: [{ header: "Ngày", key: "date", width: 14 }, money("opening", "Đầu ngày"), money("topUp", "Bổ sung quỹ"), money("in", "Tổng thu"), money("out", "Tổng chi"), money("handOver", "Nộp lại giám đốc"), money("closing", "Cuối ngày"),
        { header: "Phiếu chờ kiểm", key: "pendingCount", width: 14 }, { header: "Chốt quỹ", key: "closeState", width: 14 }, money("closeActual", "Tiền kiểm đếm"), money("closeDiff", "Chênh lệch chốt"), { header: "Người chốt", key: "closeBy", width: 22 }],
      rows: r.days.map((d) => ({
        date: `${d.ymd.slice(8, 10)}/${d.ymd.slice(5, 7)}/${d.ymd.slice(0, 4)}`, opening: d.opening, topUp: d.topUp, in: d.in, out: d.out, handOver: d.handOver, closing: d.closing, pendingCount: d.pendingCount,
        closeState: d.close ? (Number(d.close.diff) === 0 ? "Khớp" : "Chênh lệch") : "Chưa chốt", closeActual: d.close?.actual ?? null, closeDiff: d.close?.diff ?? null, closeBy: d.close?.byName ?? null,
      })),
    },
    {
      name: "Theo người kiểm tra",
      columns: [{ header: "Người kiểm tra", key: "name", width: 26 }, { header: "Số phiếu", key: "vouchers", width: 12 }, money("in", "Thu"), money("out", "Chi"), { header: "Số lần chốt quỹ", key: "closes", width: 16 }, money("closeDiff", "Chênh lệch chốt")],
      rows: r.reviewers.map((x) => ({ name: x.name, vouchers: x.vouchers, in: x.in, out: x.out, closes: x.closes, closeDiff: x.closes ? x.closeDiff : null })),
    },
  ]);
}
