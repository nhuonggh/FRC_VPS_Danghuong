import { DebtAdjustmentForm } from "@/components/debt/DebtAdjustmentForm";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { searchDebtPartners } from "@/server/debt/queries";

export const dynamic = "force-dynamic";

export default async function NewDebtAdjustmentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor("debt.adjust");
  const raw = (await searchParams).partnerId;
  const id = Array.isArray(raw) ? raw[0] : raw;
  let partner = null;
  if (id && /^\d{1,10}$/.test(id) && Number(id) > 0 && Number(id) <= 2_147_483_647) {
    const p = await prisma.partner.findFirst({ where: { id: Number(id), mergedIntoId: null }, select: { code: true } });
    const visible = p ? (await searchDebtPartners(prisma, actor, p.code)).find((o) => o.value === Number(id)) : null;
    partner = visible ? { value: visible.value, label: visible.label } : null;
  }
  return <DebtAdjustmentForm today={ictYmd(new Date())} partner={partner} />;
}
