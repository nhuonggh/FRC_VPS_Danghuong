import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { formatDateTime } from "@/lib/format";
import { buildXlsxSheets, type XlsxSheet } from "@/server/export/xlsx";
import { dailyAmountLabels, dailyRange, loadDailyItem } from "./daily";
import { dailyCanMoney, visibleDailyItems } from "./daily-config";
import { DomainError } from "@/server/http/errors";

export async function exportDaily(db: PrismaClient, actor: Actor, key: string | null, params: ListParams, now: Date): Promise<Buffer> {
  const range = dailyRange(params, now);
  const keys = key ? [key] : visibleDailyItems(actor).map((i) => i.key);
  if (!keys.length) throw new DomainError("Bạn không có quyền xem báo cáo kiểm tra hằng ngày.", 403);
  const sheets: XlsxSheet[] = [];
  const summary: Record<string, unknown>[] = [];
  let documents = 0;
  // Sequential to bound connection/memory usage. Any failure aborts the entire export (no partial file).
  for (const k of keys) {
    const data = await loadDailyItem(db, actor, k, params, now, { export: true });
    documents += data.rows.length;
    if (documents > 30000) throw new DomainError("Bộ báo cáo vượt 30.000 chứng từ. Hãy thu hẹp khoảng ngày rồi xuất lại.", 400);
    const money = dailyCanMoney(actor, data.item), [amount, extra] = dailyAmountLabels(data.item.key);
    summary.push({ item: data.item.label, count: data.totals.count, cancelled: data.totals.cancelled, amountLabel: money ? amount : "Không có quyền xem giá trị", amount: data.totals.amount, extraLabel: money ? extra : null, extra: money && extra ? data.totals.extra : null });
    const columns: XlsxSheet["columns"] = [
      { header: "Mã chứng từ", key: "code", text: true, width: 20 }, { header: "Ngày", key: "at" },
      { header: "Đối tác", key: "partner", text: true, width: 32 }, { header: "Tham chiếu / loại", key: "related", text: true, width: 25 },
      ...(money ? [{ header: amount, key: "amount", numFmt: "#,##0.00", width: 24 }, ...(extra ? [{ header: extra, key: "extra", numFmt: "#,##0.00", width: 24 }] : [])] : []),
      { header: "Trạng thái", key: "status", text: true, width: 20 }, { header: "Ghi chú", key: "note", text: true, width: 40 },
    ];
    const rows: Record<string, unknown>[] = data.rows.map((r) => ({ ...r }));
    rows.push({ code: "Tổng hiệu lực", amount: data.totals.amount, ...(extra ? { extra: data.totals.extra } : {}), note: "Không bao gồm chứng từ đã hủy." });
    sheets.push({ name: data.item.label, columns, rows });
  }
  const metadata: XlsxSheet = { name: "Thông tin báo cáo", columns: [{ header: "Thông tin", key: "key", width: 30, text: true }, { header: "Nội dung", key: "value", width: 90, text: true }], rows: [
    { key: "Từ", value: formatDateTime(range.start) }, { key: "Đến (không gồm)", value: formatDateTime(range.end) },
    { key: "Xuất lúc", value: formatDateTime(now) }, { key: "Múi giờ", value: "Việt Nam (UTC+7)" }, { key: "Tiền tệ", value: "VND" },
    { key: "Từ khóa", value: params.q ?? "" }, { key: "Bộ lọc", value: JSON.stringify(params.filters) },
    { key: "Phạm vi", value: "Toàn bộ chứng từ khớp bộ lọc trong các mục được phép xem; không giới hạn theo trang." },
    { key: "Lưu ý", value: "Không cộng giá trị các mục: nghiệp vụ có thể liên quan nhau. Trả hàng theo đơn không gồm phiếu trả kho hàng chưa giao. Hao hụt mặc định không gồm xuất hủy." },
  ] };
  return buildXlsxSheets([metadata, { name: "Tổng hợp", columns: [
    { header: "Mục kiểm tra", key: "item", text: true, width: 36 }, { header: "Số chứng từ", key: "count", numFmt: "#,##0" },
    { header: "Trong đó đã hủy", key: "cancelled", numFmt: "#,##0" }, { header: "Chỉ tiêu", key: "amountLabel", text: true, width: 28 },
    { header: "Giá trị (VND)", key: "amount", numFmt: "#,##0.00", width: 24 },
    { header: "Chỉ tiêu bổ sung", key: "extraLabel", text: true, width: 28 }, { header: "Giá trị bổ sung (VND)", key: "extra", numFmt: "#,##0.00", width: 25 },
  ], rows: summary }, ...sheets]);
}
