import type { Prisma, PrismaClient } from "@prisma/client";
import { MAX_CHANGES, formatAuditValue, type AuditDetailDto } from "@/lib/audit-format";
import { diffJson } from "@/lib/json-diff";
import { redactDeep } from "@/lib/permissions/redact";
import { redactOrderData } from "@/lib/permissions/order-analysis";
import { escapeLike } from "@/lib/search";
import { listTimeRange, sortToOrderBy, type ListParams } from "@/lib/query-params";
import { timeRangeWhere } from "@/lib/time-presets";
import { DomainError } from "@/server/http/errors";

/** Key filter của trang Nhật ký — trang danh sách và route export PHẢI dùng chung. */
export const AUDIT_FILTER_KEYS = ["user", "entity"] as const;
/** Cột được phép sắp xếp (không cho sort theo JSON/ip). Mặc định: thời gian giảm dần. */
export const AUDIT_SORTABLE = ["at", "action", "entity"] as const;
export { MAX_CHANGES, type AuditDetailDto };

const INT32_MAX = 2_147_483_647;

export function auditWhere(params: ListParams, now: Date): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  // Giá trị rác / ngoài Int32 bị bỏ qua (không làm lỗi truy vấn)
  const users = (params.filters.user ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= INT32_MAX);
  if (users.length) where.userId = { in: users };
  const entities = params.filters.entity ?? [];
  if (entities.length) where.entity = { in: entities };
  if (params.q) {
    // Prisma `contains` KHÔNG escape % và _ (xem src/lib/search.ts) → tự escape để chúng là chữ thường
    const needle = escapeLike(params.q);
    where.OR = [
      { action: { contains: needle, mode: "insensitive" } },
      { entity: { contains: needle, mode: "insensitive" } },
      { entityId: { contains: needle, mode: "insensitive" } },
    ];
  }
  // Nửa mở [gte, lt) theo giờ ICT; custom thiếu/đảo ngược → null = không lọc thời gian
  const range = listTimeRange(params, now);
  if (range) where.at = timeRangeWhere(range);
  return where;
}

/** Cột sort (allow-list) + `id` cùng chiều làm tie-break để các trang không trùng/lọt dòng khi nhiều dòng cùng thời điểm. */
export function auditOrderBy(params: ListParams): Prisma.AuditLogOrderByWithRelationInput[] {
  const [[key, dir]] = Object.entries(sortToOrderBy(params.sort, AUDIT_SORTABLE, { at: "desc" as const }));
  return [{ [key!]: dir! }, { id: dir! }];
}

// KHÔNG chọn beforeJson/afterJson/ip: bảng danh sách không cần, và không đọc JSON của 20 dòng mỗi lần
const LIST_SELECT = { id: true, userId: true, action: true, entity: true, entityId: true, at: true } as const;

/**
 * Nhật ký (mặc định mới nhất trước). Phân trang offset trên index (at): 50.000 dòng vẫn đo được vài chục ms
 * (tests/audit/perf.test.ts). `total` là 1 truy vấn count cùng where, chạy song song với trang.
 */
export async function listAudit(db: PrismaClient, params: ListParams, now: Date = new Date()) {
  const where = auditWhere(params, now);
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, select: LIST_SELECT, orderBy: auditOrderBy(params), skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
    db.auditLog.count({ where }),
  ]);
  return { rows, total };
}

/** Danh sách đối tượng đã có trong nhật ký cho bộ lọc (GROUP BY ở DB, không kéo mọi dòng về). */
export async function listAuditEntities(db: PrismaClient): Promise<string[]> {
  const groups = await db.auditLog.groupBy({ by: ["entity"], orderBy: { entity: "asc" } });
  return groups.map((g) => g.entity);
}

/** Bản ghi THÔ (có beforeJson/afterJson chưa lọc quyền) — CHỈ dùng phía server, qua `toAuditDetail` trước khi ra client. */
export async function getAuditEntry(db: PrismaClient, id: number) {
  const row = await db.auditLog.findUnique({ where: { id } });
  if (!row) throw new DomainError("Không tìm thấy dòng nhật ký.", 404);
  return row;
}

type AuditRowFull = {
  id: number; at: Date; action: string; entity: string; entityId: string | null; ip: string | null;
  beforeJson: Prisma.JsonValue | null; afterJson: Prisma.JsonValue | null;
};

/**
 * ĐƯỜNG ĐỌC audit (docs/conventions/sensitive-data.md): before/after đi qua `redactDeep` với quyền của NGƯỜI XEM
 * (bí mật đã bị bỏ lúc ghi), rồi mới so sánh + định dạng. DTO không chứa JSON thô nào.
 */
export function toAuditDetail(row: AuditRowFull, by: string, perms: ReadonlySet<string>): AuditDetailDto {
  const redact = row.entity === "SaleOrder" ? redactOrderData : redactDeep;
  const before = redact(row.beforeJson, perms);
  const after = redact(row.afterJson, perms);
  const hiddenByPermission =
    JSON.stringify(before) !== JSON.stringify(row.beforeJson) || JSON.stringify(after) !== JSON.stringify(row.afterJson);
  const all = diffJson(before, after);
  return {
    id: row.id,
    at: row.at.toISOString(),
    by,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    ip: row.ip,
    changes: all.slice(0, MAX_CHANGES).map((c) => ({ path: c.path, before: formatAuditValue(c.before), after: formatAuditValue(c.after) })),
    hiddenByPermission,
    truncated: all.length > MAX_CHANGES,
  };
}
