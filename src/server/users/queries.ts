import type { PrismaClient } from "@prisma/client";
import type { ListParams } from "@/lib/query-params";
import { normalizeSearch } from "@/lib/search";
import { DomainError } from "@/server/http/errors";

export interface UserRow {
  id: number;
  username: string;
  fullName: string;
  email: string | null;
  isLocked: boolean;
  canAdvance: boolean;
  mustChangePassword: boolean;
  createdAt: Date;
  roles: { id: number; name: string }[];
}

const SORTABLE = ["fullName", "username", "createdAt"] as const;

const USER_SELECT = {
  id: true, username: true, fullName: true, email: true, isLocked: true, canAdvance: true, mustChangePassword: true, createdAt: true,
  roles: { select: { role: { select: { id: true, name: true } } } },
} as const; // KHÔNG chọn passwordHash

/**
 * Bảng người dùng nhỏ (vài chục dòng) nên lọc/sắp xếp/phân trang trong bộ nhớ để dùng `normalizeSearch`
 * cho tên có dấu (không cần cột `searchText` cho `users`).
 */
export async function listUsers(db: PrismaClient, params: ListParams) {
  const all = await db.user.findMany({ select: USER_SELECT });
  const users: UserRow[] = all.map((u) => ({ ...u, roles: u.roles.map((r) => r.role) }));

  const needle = normalizeSearch(params.q ?? "");
  const roleFilter = (params.filters.role ?? []).map(Number);
  const scoped = users.filter(
    (u) =>
      (!needle || normalizeSearch(`${u.username} ${u.fullName} ${u.email ?? ""}`).includes(needle)) &&
      (roleFilter.length === 0 || u.roles.some((r) => roleFilter.includes(r.id))),
  );
  const stats = { all: scoped.length, active: scoped.filter((u) => !u.isLocked).length, locked: scoped.filter((u) => u.isLocked).length };
  // Số người theo từng nhóm quyền cho thanh tab (đếm sau tìm kiếm, không áp bộ lọc nhóm quyền/trạng thái đang chọn)
  const roleCounts: Record<number, number> = {};
  for (const u of users) {
    if (needle && !normalizeSearch(`${u.username} ${u.fullName} ${u.email ?? ""}`).includes(needle)) continue;
    for (const r of u.roles) roleCounts[r.id] = (roleCounts[r.id] ?? 0) + 1;
  }
  const allCount = users.filter((u) => !needle || normalizeSearch(`${u.username} ${u.fullName} ${u.email ?? ""}`).includes(needle)).length;

  const status = params.filters.status ?? [];
  const filtered = scoped.filter((u) => status.length === 0 || status.includes(u.isLocked ? "locked" : "active"));

  const desc = params.sort?.startsWith("-");
  const key = (params.sort?.replace(/^-/, "") ?? "createdAt") as (typeof SORTABLE)[number];
  const sortKey = (SORTABLE as readonly string[]).includes(key) ? key : "createdAt";
  const dir = params.sort ? (desc ? -1 : 1) : -1;
  filtered.sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    return (x instanceof Date && y instanceof Date ? x.getTime() - y.getTime() : String(x).localeCompare(String(y), "vi")) * dir;
  });

  const start = (params.page - 1) * params.pageSize;
  return { rows: filtered.slice(start, start + params.pageSize), total: filtered.length, stats, roleCounts, allCount };
}

export async function getUser(db: PrismaClient, id: number) {
  const u = await db.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!u) throw new DomainError("Không tìm thấy người dùng.", 404);
  return { ...u, roles: u.roles.map((r) => r.role) };
}
