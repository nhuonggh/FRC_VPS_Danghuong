import { notFound } from "next/navigation";
import { ReturnByOrderWorkspace } from "@/components/returns/ReturnByOrderWorkspace";
import { prisma } from "@/lib/prisma";
import { partnerScopeWhere } from "@/lib/permissions/scope";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getOrderForReturn, searchReturnableOrders } from "@/server/returns/queries";

export const dynamic = "force-dynamic";
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const validId = (v: string) => /^\d{1,10}$/.test(v) && Number(v) > 0 && Number(v) <= 2147483647;
export default async function NewReturnByOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("return.manage");
  const sp = await searchParams;
  const rawId = first(sp.orderId), rawPartner = first(sp.partnerId), undelivered = first(sp.undelivered) === "1";
  if ((rawId && !validId(rawId)) || (rawPartner && !validId(rawPartner))) notFound();
  const order = rawId ? await getOrderForReturn(prisma, actor, Number(rawId), undelivered).catch((e) => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; }) : null;
  const partnerId = rawPartner ? Number(rawPartner) : order?.partnerId;
  if (order && partnerId !== order.partnerId) notFound();
  const partner = partnerId ? await prisma.partner.findFirst({ where: { id: partnerId, ...partnerScopeWhere(actor) }, select: { id: true, code: true, name: true } }) : null;
  if (partnerId && !partner) notFound();
  const orders = await searchReturnableOrders(prisma, actor, first(sp.q).slice(0, 100), partnerId, undelivered);
  const canRefund = actor.perms.has("payment.manage") && actor.perms.has("cash.transaction.create") && !undelivered;
  const accounts = canRefund ? await prisma.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }) : [];
  return <ReturnByOrderWorkspace order={order} customer={partner ? { value: partner.id, label: `${partner.code} — ${partner.name}` } : null} orders={orders} undelivered={undelivered} today={ictYmd(new Date())} refundAccounts={canRefund ? accounts.map((a) => ({ value: a.id, label: a.name, type: a.type as "CASH" | "BANK" })) : undefined} />;
}
