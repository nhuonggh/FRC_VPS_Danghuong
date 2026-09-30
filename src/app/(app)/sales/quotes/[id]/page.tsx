import { notFound } from "next/navigation";
import { QuoteDetail } from "@/components/sales/QuoteDetail";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getQuote } from "@/server/quotes/queries";

export const dynamic = "force-dynamic";

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("quote.manage");
  const raw = (await params).id;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0 || Number(raw) > 2_147_483_647) notFound();
  const quote = await getQuote(prisma, actor, Number(raw)).catch((e) => {
    if (e instanceof DomainError && e.status === 404) notFound();
    throw e;
  });
  return <QuoteDetail quote={quote} canManage={actor.perms.has("sale_price.view")} canConvert={actor.perms.has("order.create")} />;
}
