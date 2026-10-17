import { notFound } from "next/navigation";
import { requireActor } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { ictYmd } from "@/lib/time";
import { orderInclude, receivedQty } from "@/server/supplier-orders/service";
import { SupplierOrderReceive } from "@/components/purchase/SupplierOrderReceive";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireActor("purchase.create"); await requireActor("purchase_price.view");
  const id = Number((await params).id); if (!Number.isSafeInteger(id) || id <= 0) notFound();
  const order = await prisma.supplierOrder.findUnique({ where: { id }, include: orderInclude }); if (!order || order.state !== "SENT") notFound();
  const related = await prisma.supplierOrder.findMany({ where: { partnerId: order.partnerId, state: "SENT" }, include: orderInclude, orderBy: { id: "asc" } });
  return <SupplierOrderReceive id={id} code={order.code} today={ictYmd(new Date())} lines={related.flatMap(o => o.lines.filter(l => o.id === id || receivedQty(l).lt(l.qty)).map(l => ({ lineId: l.id, label: `${o.code} · ${l.product.code} · ${l.product.name}`, unit: l.unit, ordered: l.qty.toString(), received: receivedQty(l).toString(), remaining: PrismaMax(l.qty.minus(receivedQty(l)).toString()), purchasePrice: l.purchasePrice.toString() })))} />;
}
function PrismaMax(v: string) { return Number(v) < 0 ? "0" : v; }
