import { notFound } from "next/navigation";
import { AdjustmentInDetail } from "@/components/purchase/AdjustmentInDetail";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getAdjustmentIn } from "@/server/purchase/adjustment-in";
export default async function AdjustmentInDetailPage({ params }: { params: Promise<{ id: string }> }) { const actor = await requireActor("stock_adjust.manage"), raw = (await params).id; if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0) notFound(); const adjustment = await getAdjustmentIn(prisma, actor, Number(raw)).catch((error) => { if (error instanceof DomainError && error.status === 404) notFound(); throw error; }); return <AdjustmentInDetail adjustment={adjustment} canCancel />; }
