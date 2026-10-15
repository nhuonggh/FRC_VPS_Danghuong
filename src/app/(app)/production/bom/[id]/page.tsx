import { notFound } from "next/navigation";
import { BomDetail } from "@/components/bom/BomDetail";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { getBom } from "@/server/bom";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";

export default async function BomDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("bom.manage");
  const raw = (await params).id;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0 || Number(raw) > 2_147_483_647) notFound();
  const now = new Date();
  const bom = await getBom(prisma, Number(raw), now).catch((error) => {
    if (error instanceof DomainError && error.status === 404) notFound();
    throw error;
  });
  return <BomDetail bom={bom} canManage={actor.perms.has("bom.manage")} today={ictYmd(now)} />;
}
