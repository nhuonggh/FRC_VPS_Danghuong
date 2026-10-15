import { RollTable } from "@/components/inventory/RollTable";
import { EmptyState, ExportButton, ListPageLayout, SearchBox } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { rollLookup } from "@/server/inventory-reports/rolls";
const BASE = "/inventory/rolls";
export default async function RollsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { await requireActor("stock.view"); const params = parseListParams(await searchParams, []), rows = await rollLookup(prisma, params.q); return <ListPageLayout title="Tra cứu cuộn" actions={<ExportButton href={`/api/inventory/rolls/export${params.q ? `?q=${encodeURIComponent(params.q)}` : ""}`} />} filters={<SearchBox basePath={BASE} params={params} placeholder="Tìm mã, tên, ghi chú cuộn…" />} footer={null}>{rows.length ? <RollTable rows={rows} /> : <EmptyState kind="empty" title="Chưa có dữ liệu cuộn" />}</ListPageLayout>; }
