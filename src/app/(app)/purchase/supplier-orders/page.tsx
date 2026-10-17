import { SupplierOrderReferenceFilters } from "@/components/purchase/SupplierOrderReferenceFilters";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, EmptyState, ListPageLayout, PaginationFooter } from "@/components/ui";
import { requireActor } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { formatDate, formatQty } from "@/lib/format";
import { ictYmd } from "@/lib/time";
import { listSupplierOrders } from "@/server/supplier-orders/queries";
import { progress, receivedQty } from "@/server/supplier-orders/service";
import { ORDER_STATUSES } from "@/components/purchase/supplier-order-status";
import { SupplierOrderNotices } from "@/components/purchase/SupplierOrderNotices";
const BASE = "/purchase/supplier-orders";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("purchase.view"); await requireActor("purchase_price.view");
  const s = await searchParams, str = (k: string) => typeof s[k] === "string" ? s[k] as string : "";
  const page = Math.max(1, Math.min(100000, Math.floor(Number(str("page")) || 1)));
  const result = await listSupplierOrders(prisma, actor, { q: str("q").slice(0, 200), status: str("status"), mine: str("mine") === "1", overdue: str("overdue") === "1", page, partnerId: Number(str("partnerId")) || undefined, creatorId: Number(str("creatorId")) || undefined });
  const href = (p: { page?: number }) => { const qs = new URLSearchParams(); for (const [k, v] of Object.entries(s)) if (typeof v === "string") qs.set(k, v); qs.set("page", String(p.page ?? page)); return `${BASE}?${qs}`; };
  const [supplier, people] = await Promise.all([
    Number(str("partnerId")) > 0 ? prisma.partner.findUnique({ where: { id: Number(str("partnerId")) }, select: { id: true, name: true } }) : Promise.resolve(null),
    prisma.user.findMany({ where: { supplierOrders: { some: {} } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  const options = people.map(u => ({ value: u.id, label: u.fullName }));
  const control = "h-11 rounded-sm border border-border bg-surface px-3 text-sm md:h-10";
  return <ListPageLayout title="Đặt hàng nhà cung cấp" actions={actor.perms.has("purchase.create") ? <Link href={`${BASE}/new`} className={`${control} flex items-center gap-2 bg-accent text-fg-on-accent`}><Plus size={16} />Đặt hàng</Link> : undefined}
    filters={<div className="space-y-3"><SupplierOrderNotices /><form action={BASE} className="flex flex-wrap items-center gap-2"><input name="q" defaultValue={str("q")} aria-label="Tìm đơn đặt" placeholder="Mã đơn, nhà cung cấp, người đặt…" className={control} /><SupplierOrderReferenceFilters supplier={supplier ? { value: supplier.id, label: supplier.name } : null} creator={options.find(o => o.value === Number(str("creatorId"))) ?? null} people={options} /><select name="status" defaultValue={str("status")} aria-label="Trạng thái" className={control}><option value="">Tất cả trạng thái</option>{Object.entries(ORDER_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="mine" value="1" defaultChecked={str("mine") === "1"} />Đơn của tôi</label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="overdue" value="1" defaultChecked={str("overdue") === "1"} />Quá hạn giao</label><button className={control}>Lọc</button><Link href={BASE} className={`${control} flex items-center`}>Đặt lại</Link></form></div>}
    footer={<PaginationFooter total={result.total} page={page} pageSize={20} buildHref={href} />}>
    {result.rows.length ? <div className="overflow-hidden rounded-sm border border-border"><table className="line-table w-full text-sm"><thead className="bg-hover text-left text-xs text-fg-secondary"><tr>{["Đơn đặt", "Nhà cung cấp", "Người đặt", "Ngày đặt", "Tiến độ", "Trạng thái"].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{result.rows.map(o => {
      const state = ORDER_STATUSES[progress(o)], done = o.lines.filter(l => receivedQty(l).gte(l.qty)).length;
      const late = o.state === "SENT" && o.lines.some(l => l.expectedDate && l.expectedDate.toISOString().slice(0,10) < ictYmd(new Date()) && receivedQty(l).lt(l.qty));
      return <tr key={o.id} className="border-t border-border"><td data-label="Đơn đặt" className="p-3"><Link href={`${BASE}/${o.id}`} className="font-medium text-accent">{o.code}</Link></td><td data-label="Nhà cung cấp" className="p-3">{o.partner.name}</td><td data-label="Người đặt" className="p-3">{o.creator.fullName}</td><td data-label="Ngày đặt" className="p-3">{formatDate(o.date)}</td><td data-label="Tiến độ" className="p-3 tabular">{formatQty(done)}/{formatQty(o.lines.length)} dòng đủ</td><td data-label="Trạng thái" className="p-3"><Badge tone={state.tone}>{state.label}</Badge>{late && <span className="ml-2 text-danger">Quá hạn giao</span>}</td></tr>;
    })}</tbody></table></div> : <EmptyState kind="empty" title="Chưa có đơn phù hợp" action={actor.perms.has("purchase.create") ? <Link href={`${BASE}/new`} className="text-accent">Đặt hàng nhà cung cấp</Link> : undefined} />}
  </ListPageLayout>;
}
