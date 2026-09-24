import type { PrismaClient } from "@prisma/client";
import { truncateText } from "@/lib/audit-format";
import { formatDateTime, formatNumber } from "@/lib/format";
import { redactDeep } from "@/lib/permissions/redact";
import type { ListParams } from "@/lib/query-params";
import { auditWhere } from "@/server/audit/queries";
import { buildXlsxBatched, type XlsxColumn } from "@/server/export/xlsx";

/**
 * Xuất tối đa từng này dòng (mới nhất trước); vượt → cắt và ghi chú rõ ở cuối file. Nhỏ có chủ đích: app chạy 1 tiến trình Node,
 * xuất đồng bộ ~10.000 dòng có payload JSON đo được ~2 giây (50.000 dòng ~10 giây làm nghẽn các request khác).
 */
export const MAX_EXPORT_ROWS = 10_000;
/** Đọc DB theo lô từng này dòng (con trỏ), nhường vòng lặp sự kiện giữa các lô. */
export const EXPORT_BATCH_SIZE = 500;
/** Excel giới hạn 32.767 ký tự/ô; chừa chỗ cho dấu '…'. */
export const EXPORT_CELL_MAX_CHARS = 32_000;

const COLUMNS: XlsxColumn[] = [
  { header: "Thời gian", key: "at", width: 20 },
  { header: "Người thao tác", key: "by", width: 24 },
  { header: "Hành động", key: "action", width: 26 },
  { header: "Đối tượng", key: "entity", width: 18 },
  { header: "Mã", key: "entityId", width: 12, text: true },
  { header: "Số cũ", key: "before", width: 40 },
  { header: "Số mới", key: "after", width: 40 },
];

const cellJson = (v: unknown) => (v === null || v === undefined ? null : truncateText(JSON.stringify(v), EXPORT_CELL_MAX_CHARS));

/**
 * Xuất nhật ký theo ĐÚNG bộ lọc của trang (người, đối tượng, từ khóa, thời gian ICT; `page/pageSize/sort` bị bỏ qua:
 * luôn mới nhất trước để "N dòng mới nhất" đúng nghĩa). Số cũ/số mới đi qua `redactDeep` với quyền của người xuất.
 */
export async function exportAuditXlsx(
  db: PrismaClient,
  params: ListParams,
  perms: ReadonlySet<string>,
  opts: { now?: Date; maxRows?: number; batchSize?: number } = {},
): Promise<{ buffer: Buffer; rowCount: number; truncated: boolean }> {
  const max = opts.maxRows ?? MAX_EXPORT_ROWS;
  const batchSize = Math.max(1, opts.batchSize ?? EXPORT_BATCH_SIZE);
  const where = auditWhere(params, opts.now ?? new Date());
  const names = new Map<number, string>();
  let rowCount = 0;
  let truncated = false;

  // Lô theo con trỏ id (orderBy at desc, id desc): lấy tối đa max + 1 dòng để biết có bị cắt (không cần count riêng);
  // dòng thứ max + 1 chỉ dùng để phát hiện, không ghi ra file.
  async function* batches(): AsyncGenerator<Record<string, unknown>[]> {
    let cursor: number | undefined;
    let fetched = 0;
    while (fetched < max + 1) {
      const take = Math.min(batchSize, max + 1 - fetched);
      const rows = await db.auditLog.findMany({
        where,
        orderBy: [{ at: "desc" }, { id: "desc" }],
        take,
        ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
        select: { id: true, userId: true, action: true, entity: true, entityId: true, beforeJson: true, afterJson: true, at: true },
      });
      if (rows.length === 0) return;
      fetched += rows.length;
      cursor = rows[rows.length - 1]!.id;
      const keep = fetched > max ? rows.slice(0, rows.length - (fetched - max)) : rows;
      if (fetched > max) truncated = true;

      const missing = [...new Set(keep.map((r) => r.userId).filter((x): x is number => x !== null && !names.has(x)))];
      if (missing.length) {
        for (const u of await db.user.findMany({ where: { id: { in: missing } }, select: { id: true, fullName: true } })) names.set(u.id, u.fullName);
      }
      rowCount += keep.length;
      yield keep.map((r) => ({
        at: formatDateTime(r.at),
        by: r.userId === null ? "Hệ thống" : (names.get(r.userId) ?? `#${r.userId}`),
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        before: cellJson(redactDeep(r.beforeJson, perms)),
        after: cellJson(redactDeep(r.afterJson, perms)),
      }));
      if (rows.length < take) return; // hết dữ liệu
    }
  }

  const buffer = await buildXlsxBatched("Nhật ký", COLUMNS, batches(), {
    note: () => truncated
      ? `Chỉ xuất ${formatNumber(max)} dòng mới nhất — còn dòng cũ hơn chưa xuất. Hãy thu hẹp bộ lọc (thời gian, người thao tác, đối tượng) rồi xuất lại.`
      : null,
  });
  return { buffer, rowCount, truncated };
}
