import { ExportButton, EmptyState, ListPageLayout, PaginationFooter, SearchBox, StatCard } from "@/components/ui";
import { resolveSection } from "@/config/catalog-sections";
import { buildExportHref, buildListHref, parseListParams } from "@/lib/query-params";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { countAllCatalogs, listCatalog } from "@/server/catalog/queries";
import { CatalogSidebar } from "./CatalogSidebar";
import { CatalogTable, NewCatalogButton } from "./CatalogTable";

export default async function CatalogSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireActor("catalog.manage");
  const sp = await searchParams;
  const section = resolveSection(typeof sp.section === "string" ? sp.section : undefined);
  const params = parseListParams(sp, ["status"]);
  const [{ rows, total, stats }, counts] = await Promise.all([listCatalog(prisma, section.key, params), countAllCatalogs(prisma)]);
  const basePath = `/system/catalog-settings?section=${section.key}`;
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(basePath, params, patch);
  return <div className="flex min-h-0 flex-col gap-4 lg:flex-row"><CatalogSidebar selected={section.key} counts={counts} /><ListPageLayout title={section.label} actions={<><ExportButton href={buildExportHref(`/api/catalog/${section.key}/export`, params)} /><NewCatalogButton section={section} /></>} stats={<><StatCard label="Tất cả" value={stats.all} /><StatCard label="Đang dùng" value={stats.active} tone="success" /><StatCard label="Đã tắt" value={stats.inactive} /></>} filters={<SearchBox basePath={basePath} params={params} placeholder={`Tìm ${section.label.toLowerCase()}…`} />} footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={href} />}>
    {total === 0 ? <EmptyState kind={params.q || params.filters.status?.length ? "no-result" : "empty"} title={params.q ? "Không tìm thấy dữ liệu phù hợp" : `Chưa có ${section.label.toLowerCase()}`} /> : <CatalogTable section={section} rows={rows} sort={params.sort} buildSortHref={(sort) => href({ sort })} />}
  </ListPageLayout></div>;
}
