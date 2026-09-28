import { XntTable } from "@/components/inventory/XntTable";
import { ListPageLayout } from "@/components/ui";
import { ictStartOfDay, toIct } from "@/lib/time";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { xntReport } from "@/server/inventory-reports/xnt";
export default async function XntPage() { const actor = await requireActor("stock.view"), now = toIct(new Date()), from = ictStartOfDay(now.y, now.m, 1), to = new Date(); const rows = await xntReport(prisma, actor, from, to); return <ListPageLayout title="Báo cáo xuất nhập tồn" filters={<p className="text-sm text-fg-secondary">Từ đầu tháng đến hiện tại</p>} footer={null}><XntTable rows={rows} /></ListPageLayout>; }
