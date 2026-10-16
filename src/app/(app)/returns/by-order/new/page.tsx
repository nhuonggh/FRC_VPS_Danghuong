import Link from "next/link";
import { notFound } from "next/navigation";
import { ReturnByOrderForm } from "@/components/returns/ReturnByOrderForm";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { formatDate } from "@/lib/format";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getOrderForReturn, searchReturnableOrders } from "@/server/returns/queries";

export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Bước 1: chọn đơn (tìm theo mã đơn / khách). Bước 2 (?orderId=): nhập SL trả từng dòng. */
export default async function NewReturnByOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("return.manage");
  const sp = await searchParams;
  const rawId = first(sp.orderId);
  if (rawId) {
    if (!/^\d{1,10}$/.test(rawId) || Number(rawId) <= 0 || Number(rawId) > 2_147_483_647) notFound();
    const order = await getOrderForReturn(prisma, actor, Number(rawId), first(sp.undelivered) === "1").catch((e) => {
      if (e instanceof DomainError && e.status === 404) notFound();
      throw e;
    });
    const canRefund = actor.perms.has("payment.manage") && actor.perms.has("cash.transaction.create") && !order.undelivered;
    const accounts = canRefund ? await prisma.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }) : [];
    return <ReturnByOrderForm order={order} today={ictYmd(new Date())} refundAccounts={canRefund ? accounts.map((a) => ({ value: a.id, label: a.name, type: a.type as "CASH" | "BANK" })) : undefined} />;
  }
  const q = first(sp.q).slice(0, 100);
  const orders = await searchReturnableOrders(prisma, actor, q);
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-lg font-semibold">Trả hàng theo đơn — chọn đơn</h1>
      <form method="get" className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="Mã đơn hoặc tên khách…" aria-label="Tìm đơn" className="h-11 flex-1 rounded-sm border border-border bg-canvas px-3 text-sm md:h-10" />
        <button type="submit" className="h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10">Tìm</button>
      </form>
      <p className="text-sm text-fg-secondary">Chỉ hiện đơn đã giao ít nhất một phần. Khách không nhớ đơn: dùng “Trả theo sản phẩm”.</p>
      {orders.length === 0 ? <p className="text-sm text-fg-muted">Không có đơn phù hợp.</p> : (
        <ul className="divide-y divide-border rounded-sm border border-border">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/returns/by-order/new?orderId=${o.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 hover:bg-hover">
                <span><span className="font-mono text-xs">{o.code}</span> · <strong>{o.partnerName}</strong></span>
                <span className="text-sm text-fg-muted">{formatDate(o.orderDate)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
