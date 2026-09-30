import { notFound } from "next/navigation";
import { ReturnDetail } from "@/components/returns/ReturnDetail";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getReturn } from "@/server/returns/queries";

export const dynamic = "force-dynamic";

export default async function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("return.manage");
  const raw = (await params).id;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0 || Number(raw) > 2_147_483_647) notFound();
  const ret = await getReturn(prisma, actor, Number(raw)).catch((e) => {
    if (e instanceof DomainError && e.status === 404) notFound();
    throw e;
  });
  return <ReturnDetail ret={ret} canManage />;
}
