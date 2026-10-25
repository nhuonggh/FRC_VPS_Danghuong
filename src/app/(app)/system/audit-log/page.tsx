import { StatCard } from "@/components/ui/StatCard";
import { auditEntityLabel } from "@/lib/audit-labels";
import Link from "next/link";
import { EmptyState, ExportButton, ListPageLayout, MultiSelectFilter, PaginationFooter, SearchBox } from "@/components/ui";
import { QuickTimeFilter } from "@/components/ui/QuickTimeFilter";
import { formatNumber } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { buildExportHref, buildListHref, parseTimedListParams } from "@/lib/query-params";
import { MAX_EXPORT_ROWS } from "@/server/audit/export";
import { AUDIT_FILTER_KEYS, auditStats, listAudit, listAuditEntities } from "@/server/audit/queries";
import { requireActor } from "@/server/auth/session";
import { AuditTable } from "./AuditTable";

const BASE = "/system/audit-log";

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireActor("audit.view");
  const params = parseTimedListParams(await searchParams, AUDIT_FILTER_KEYS);
  const [{ rows, total }, users, entities, stats] = await Promise.all([
    listAudit(prisma, params),
    prisma.user.findMany({ select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    listAuditEntities(prisma),
    auditStats(prisma, params),
  ]);
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  const filtered = !!(params.q || params.timePreset || params.filters.user || params.filters.entity);

  return (
    <ListPageLayout
      title="Nhật ký thao tác"
      // Nhật ký append-only: KHÔNG có Thêm mới / Import / Sửa / Xóa — chỉ Xuất Excel (đúng bộ lọc đang xem)
      actions={
        <>
          {total > MAX_EXPORT_ROWS && (
            <span role="note" className="text-xs text-warning">
              {`Xuất Excel chỉ gồm ${formatNumber(MAX_EXPORT_ROWS)} dòng mới nhất — hãy thu hẹp bộ lọc.`}
            </span>
          )}
          <ExportButton href={buildExportHref("/api/audit-log/export", params)} />
        </>
      }
      description="Thống kê theo bộ lọc hiện tại"
      statsClassName="!grid grid-cols-1 md:grid-cols-4"
      stats={<><StatCard label="Tổng thao tác" value={total} /><StatCard label="Người thao tác" value={stats.users} /><StatCard label="Loại hành động" value={stats.actions} /><StatCard label="Loại đối tượng" value={stats.entities} /></>}
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox basePath={BASE} params={params} placeholder="Tìm hành động, đối tượng, mã…" />
          <QuickTimeFilter basePath={BASE} params={params} />
          <MultiSelectFilter label="Người thao tác" paramKey="user" basePath={BASE} params={params} options={users.map((u) => ({ value: String(u.id), label: u.fullName }))} />
          <MultiSelectFilter label="Đối tượng" paramKey="entity" basePath={BASE} params={params} options={entities.map((e) => ({ value: e, label: auditEntityLabel(e) }))} />
        </div>
      }
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(patch) => buildListHref(BASE, params, patch)} />}
    >
      {total === 0 ? (
        filtered
          ? <EmptyState kind="no-result" title="Không tìm thấy nhật ký phù hợp" description="Thử đổi từ khóa, khoảng thời gian hoặc xóa bộ lọc." action={<Link href={BASE} className="text-sm font-medium text-accent">Xóa bộ lọc</Link>} />
          : <EmptyState kind="empty" title="Chưa có nhật ký nào" description="Mọi thao tác ghi dữ liệu sẽ xuất hiện ở đây." />
      ) : (
        // DTO tối thiểu: chỉ tên người + siêu dữ liệu, KHÔNG có JSON before/after/ip
        <AuditTable
          params={params}
          rows={rows.map((r) => ({
            id: r.id, at: r.at.toISOString(),
            by: r.userId === null ? "Hệ thống" : (names.get(r.userId) ?? `#${r.userId}`),
            action: r.action, entity: r.entity, entityId: r.entityId,
          }))}
        />
      )}
    </ListPageLayout>
  );
}
