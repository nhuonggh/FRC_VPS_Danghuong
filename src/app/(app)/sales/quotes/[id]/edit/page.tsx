import { notFound, redirect } from "next/navigation";
import { QuoteForm } from "@/components/sales/QuoteForm";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getQuoteForEdit } from "@/server/quotes/queries";

export const dynamic = "force-dynamic";

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("quote.manage");
  if (!actor.perms.has("sale_price.view")) redirect("/403");
  const raw = (await params).id;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0 || Number(raw) > 2_147_483_647) notFound();
  const edit = await getQuoteForEdit(prisma, actor, Number(raw)).catch((e) => {
    if (e instanceof DomainError && e.status === 404) notFound();
    if (e instanceof DomainError && e.status === 409) redirect(`/sales/quotes/${raw}`); // đã chốt: chỉ xem
    throw e;
  });
  return <QuoteForm today={ictYmd(new Date())} edit={{ quoteId: edit.quoteId, code: edit.code, customer: edit.customer, products: edit.products, defaults: edit.defaults }} />;
}
