import type { PrismaClient } from "@prisma/client";
import { truncateText } from "@/lib/audit-format";
import { formatDateTime, formatNumber } from "@/lib/format";
import { redactDeep } from "@/lib/permissions/redact";
import type { ListParams } from "@/lib/query-params";
import { auditWhere } from "@/server/audit/queries";
import { buildXlsx, type XlsxColumn } from "@/server/export/xlsx";

/** Xuất tối đa từng này dòng (mới nhất trước); vượt → cắt và ghi chú rõ ở cuối file. */
export const MAX_EXPORT_ROWS = 50_000;
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
  opts: { now?: Date; maxRows?: number } = {},
): Promise<{ buffer: Buffer; rowCount: number; truncated: boolean }> {
  const max = opts.maxRows ?? MAX_EXPORT_ROWS;
  // Lấy max + 1 để biết có bị cắt hay không (không cần count riêng)
  const fetched = await db.auditLog.findMany({
    where: auditWhere(params, opts.now ?? new Date()),
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: max + 1,
    select: { userId: true, action: true, entity: true, entityId: true, beforeJson: true, afterJson: true, at: true },
  });
  const truncated = fetched.length > max;
  const rows = truncated ? fetched.slice(0, max) : fetched;

  const ids = [...new Set(rows.map((r) => r.userId).filter((x): x is number => x !== null))];
  const names = new Map(
    (await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]),
  );

  const data: Record<string, unknown>[] = rows.map((r) => ({
    at: formatDateTime(r.at),
    by: r.userId === null ? "Hệ thống" : (names.get(r.userId) ?? `#${r.userId}`),
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    before: cellJson(redactDeep(r.beforeJson, perms)),
    after: cellJson(redactDeep(r.afterJson, perms)),
  }));
  if (truncated) {
    data.push({
      action: `Chỉ xuất ${formatNumber(max)} dòng mới nhất — còn dòng cũ hơn chưa xuất. Hãy thu hẹp bộ lọc (thời gian, người thao tác, đối tượng) rồi xuất lại.`,
    });
  }
  return { buffer: await buildXlsx("Nhật ký", COLUMNS, data), rowCount: rows.length, truncated };
}
