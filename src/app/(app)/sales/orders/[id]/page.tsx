import { notFound } from "next/navigation";
import { OrderDetail } from "@/components/sales/OrderDetail";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getOrder } from "@/server/sales/queries";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("order.view");
  const raw = (await params).id;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) <= 0 || Number(raw) > 2_147_483_647) notFound();
  const order = await getOrder(prisma, actor, Number(raw)).catch((e) => {
    if (e instanceof DomainError && e.status === 404) notFound();
    throw e;
  });
  return (
    <OrderDetail order={order} today={ictYmd(new Date())}
      perms={{ canEdit: actor.perms.has("order.edit") && actor.perms.has("sale_price.view"), canCancel: actor.perms.has("order.cancel"), canRestore: actor.perms.has("order.restore") }} />
  );
}
