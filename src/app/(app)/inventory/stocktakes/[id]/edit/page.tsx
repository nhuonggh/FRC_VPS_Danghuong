import { notFound, redirect } from "next/navigation";
import { StocktakeForm } from "@/components/stocktake/StocktakeForm";
import { ictYmd } from "@/lib/time";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getStocktake } from "@/server/stocktake/queries";

export default async function EditStocktakePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("stocktake.manage"), raw = (await params).id;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0) notFound();
  const st = await getStocktake(prisma, actor, Number(raw)).catch((error) => { if (error instanceof DomainError && error.status === 404) notFound(); throw error; });
  if (st.status !== "DRAFT") redirect(`/inventory/stocktakes/${st.id}`);
  const initial = { id: st.id, date: ictYmd(st.at), note: st.note ?? "", lines: st.lines.map((l) => ({ productId: l.productId, label: `${l.productCode} — ${l.productName}`, hint: l.baseUnit, baseUnit: l.baseUnit, actualQty: Number(l.actualQty) })) };
  return <StocktakeForm today={ictYmd(new Date())} initial={initial} />;
}
