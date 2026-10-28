import { notFound, redirect } from "next/navigation";
import { AdjustmentInForm } from "@/components/purchase/AdjustmentInForm";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getAdjustmentIn } from "@/server/purchase/adjustment-in";

export const dynamic = "force-dynamic";
/** Sửa phiếu nhập kho không NCC: dùng lại form lập phiếu, điền sẵn dòng hàng hiện có. */
export default async function EditAdjustmentInPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("stock_adjust.manage"), raw = (await params).id;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0) notFound();
  const adj = await getAdjustmentIn(prisma, actor, Number(raw)).catch((error) => { if (error instanceof DomainError && error.status === 404) notFound(); throw error; });
  if (adj.isCancelled) redirect(`/purchase/adjustments-in/${adj.id}`);
  return <AdjustmentInForm today={ictYmd(new Date())} canSetCost={actor.perms.has("cost.view")} edit={{
    id: adj.id, code: adj.code, date: ictYmd(adj.at), note: adj.note ?? "",
    lines: adj.lines.map((l) => ({ productId: l.productId, qty: Number(l.qty), unitCost: l.unitCost === undefined ? null : Number(l.unitCost), label: `${l.productCode} — ${l.productName}`, baseUnit: l.baseUnit })),
  }} />;
}
