import { CloseChecklist } from "@/components/period/CloseChecklist";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { getCloseChecklist } from "@/server/period/close-checklist";

export const dynamic = "force-dynamic";

export default async function PeriodClosePage() {
  await requireActor("period.close");
  const checklist = await getCloseChecklist(prisma);
  return <CloseChecklist checklist={checklist} />;
}