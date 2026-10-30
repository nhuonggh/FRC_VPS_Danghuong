import { Plus } from "lucide-react";
import Link from "next/link";
import { EmptyState, ListPageLayout, PaginationFooter, SearchBox, StatCard } from "@/components/ui";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listUsers } from "@/server/users/queries";
import { UsersTable } from "./UsersTable";

const BASE = "/system/users";

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("user.view");
  const params = parseListParams(await searchParams, ["status", "role"]);
  const [{ rows, total, stats, roleCounts, allCount }, roles] = await Promise.all([listUsers(prisma, params), prisma.role.findMany({ orderBy: { id: "asc" } })]);
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(BASE, params, patch);
  const status = params.filters.status?.[0];
  const canManage = actor.perms.has("user.manage");
  const filtered = !!(params.q || params.filters.status || params.filters.role);
  const activeRole = params.filters.role?.[0];
  const tabs = [{ key: "", label: "Tất cả", count: allCount }, ...roles.map((r) => ({ key: String(r.id), label: r.name, count: roleCounts[r.id] ?? 0 }))];

  return (
    <ListPageLayout
      title="Người dùng"
      actions={canManage && (
        <Link href={`${BASE}/new`} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 md:h-10 text-sm font-medium text-fg-on-accent">
          <Plus size={16} aria-hidden /> Thêm mới
        </Link>
      )}
      // Số đếm KHÔNG áp bộ lọc trạng thái đang chọn (listUsers đếm sau tìm kiếm + nhóm quyền, trước trạng thái)
      stats={<>
        <StatCard label="Tổng" value={stats.all} href={href({ filters: { status: [] } })} active={!status} />
        <StatCard label="Đang hoạt động" value={stats.active} tone="success" href={href({ filters: { status: ["active"] } })} active={status === "active"} />
        <StatCard label="Đã khóa" value={stats.locked} tone="danger" href={href({ filters: { status: ["locked"] } })} active={status === "locked"} />
      </>}
      filters={
        <div className="space-y-3">
          <SearchBox basePath={BASE} params={params} placeholder="Tìm họ tên, tên đăng nhập, email…" />
          <nav aria-label="Nhóm quyền" className="flex overflow-x-auto border-b border-border">
            {tabs.map((t) => {
              const on = (activeRole ?? "") === t.key;
              return (
                <Link key={t.key || "all"} href={href({ filters: { role: t.key ? [t.key] : [] } })} aria-current={on ? "page" : undefined}
                  className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium ${on ? "border-accent text-accent" : "border-transparent text-fg-secondary hover:bg-hover"}`}>
                  {t.label}
                  <span className={`tabular rounded-full px-2 py-1 text-xs ${on ? "bg-accent-soft text-accent" : "bg-hover text-fg-secondary"}`}>{t.count}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      }
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(p) => href(p)} />}
    >
      {total === 0 ? (
        filtered
          ? <EmptyState kind="no-result" title="Không tìm thấy người dùng phù hợp" description="Thử đổi từ khóa hoặc xóa bộ lọc." action={<Link href={BASE} className="text-sm font-medium text-accent">Xóa bộ lọc</Link>} />
          : <EmptyState kind="empty" title="Chưa có người dùng nào" action={canManage ? <Link href={`${BASE}/new`} className="text-sm font-medium text-accent">Tạo người dùng đầu tiên</Link> : undefined} />
      ) : (
        <UsersTable rows={rows} canManage={canManage} selfId={actor.userId} params={params} />
      )}
    </ListPageLayout>
  );
}
