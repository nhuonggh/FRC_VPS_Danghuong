import { Plus } from "lucide-react";
import Link from "next/link";
import { BomTable } from "@/components/bom/BomTable";
import { ImportExportMenu } from "@/components/import/ImportExportMenu";
import { EmptyState, ListPageLayout, MultiSelectFilter, PaginationFooter, SearchBox, StatCard } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { buildListHref, parseListParams } from "@/lib/query-params";
import { BOM_FILTER_KEYS, listBoms } from "@/server/bom/queries";
import { listActiveOptions } from "@/server/catalog/queries";
import { requireActor } from "@/server/auth/session";

const BASE = "/production/bom";

export default async function BomListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("bom.manage");
  const params = parseListParams(await searchParams, BOM_FILTER_KEYS);
  const [{ rows, total }, processingTypes] = await Promise.all([listBoms(prisma, params), listActiveOptions(prisma, "processing-types")]);
  const href = (patch: Parameters<typeof buildListHref>[2]) => buildListHref(BASE, params, patch);
  const filtered = !!(params.q || params.filters.processingType);
  const canManage = actor.perms.has("bom.manage");
  const canImport = canManage && actor.perms.has("data.import");

  return (
    <ListPageLayout
      title="Định mức nguyên vật liệu"
      actions={(
        <>
          <ImportExportMenu exportHref="/api/bom/export" importTitle="Nhập định mức từ Excel" {...(canImport ? { importEndpoint: "/api/bom/import", templateHref: "/api/bom/import-template" } : {})} />
          {canManage && (
            <Link href={`${BASE}/new`} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10">
              <Plus size={16} aria-hidden />Thêm định mức
            </Link>
          )}
        </>
      )}
      stats={<StatCard label="Số định mức" value={total} href={href({ filters: { processingType: [] } })} active={!filtered} />}
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox basePath={BASE} params={params} placeholder="Tìm mã, tên thành phẩm…" />
          <MultiSelectFilter label="Kiểu gia công" paramKey="processingType" basePath={BASE} params={params}
            options={processingTypes.map((o) => ({ value: String(o.value), label: o.label }))} />
        </div>
      }
      footer={<PaginationFooter total={total} page={params.page} pageSize={params.pageSize} buildHref={(page) => href(page)} />}
    >
      {total === 0 ? (
        <EmptyState
          kind={filtered ? "no-result" : "empty"}
          title={filtered ? "Không tìm thấy định mức phù hợp" : "Chưa có định mức nào"}
          description={filtered ? "Thử đổi từ khóa hoặc xóa bộ lọc." : undefined}
          action={filtered
            ? <Link href={BASE} className="text-sm font-medium text-accent">Xóa bộ lọc</Link>
            : canManage ? <Link href={`${BASE}/new`} className="text-sm font-medium text-accent">Thêm định mức đầu tiên</Link> : undefined}
        />
      ) : (
        <BomTable rows={rows} canManage={canManage} params={params} />
      )}
    </ListPageLayout>
  );
}
