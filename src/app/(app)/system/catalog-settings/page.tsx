import { ImportExportMenu } from "@/components/import/ImportExportMenu";
import { EmptyState, ListPageLayout, PaginationFooter, SearchBox, StatCard } from "@/components/ui";
import { resolveSection } from "@/config/catalog-sections";
import { buildExportHref, buildListHref, parseListParams } from "@/lib/query-params";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { countAllCatalogs, listCatalog } from "@/server/catalog/queries";
import { CatalogSidebar } from "./CatalogSidebar";
import { CatalogTable, NewCatalogButton } from "./CatalogTable";

export default async function CatalogSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("catalog.manage");
  const sp = await searchParams;
  const section = resolveSection(typeof sp.section === "string" ? sp.section : undefined);
  const params = parseListParams(sp, ["status"]);
  const [{ rows, total, stats }, counts] = await Promise.all([listCatalog(prisma, section.key, params), countAllCatalogs(prisma)]);
  const basePath = `/system/catalog-settings?section=${section.key}`;
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(basePath, params, patch);
  return <div className="flex h-full min-h-0 w-full flex-col gap-4 lg:flex-row"><CatalogSidebar selected={section.key} counts={counts} /><div className="min-h-0 min-w-0 flex-1"><ListPageLayout title={section.label} actions={<><ImportExportMenu exportHref={buildExportHref(`/api/catalog/${section.key}/export`, params)} importTitle={`Nhập ${section.singular} từ Excel`} {...(actor.perms.has("data.import") ? { importEndpoint: `/api/catalog/${section.key}/import`, templateHref: `/api/catalog/${section.key}/import-template` } : {})} /><NewCatalogButton section={section} /></>} statsClassName="grid grid-cols-1 gap-3 sm:grid-cols-3" stats={<><StatCard label="Tất cả" value={stats.all} /><StatCard label="Đang dùng" value={stats.active} tone="success" /><StatCard label="Đã tắt" value={stats.inactive} /></>} filters={<SearchBox basePath={basePath} params={params} className="md:max-w-xl" placeholder={`Tìm ${section.label.toLowerCase()}…`} />} footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={href} />}>
    {total === 0 ? <EmptyState kind={params.q || params.filters.status?.length ? "no-result" : "empty"} title={params.q ? "Không tìm thấy dữ liệu phù hợp" : `Chưa có ${section.label.toLowerCase()}`} /> : <CatalogTable section={section} rows={rows} params={params} basePath={basePath} />}
  </ListPageLayout></div></div>;
}
