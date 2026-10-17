import { Prisma, type PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { orderInclude } from "./service";
import { ictYmd } from "@/lib/time";

// Derive receipt state from active purchase lines; cancelled receipts never count.
const received = Prisma.sql`COALESCE((SELECT SUM(r.qty) FROM purchase_lines r JOIN purchases p ON p.id=r."purchaseId" WHERE r."supplierOrderLineId"=l.id AND NOT p."isCancelled"),0)`;
const status = Prisma.sql`CASE WHEN o.state <> 'SENT' THEN o.state
 WHEN NOT EXISTS(SELECT 1 FROM supplier_order_lines l WHERE l."orderId"=o.id AND ${received}<l.qty) THEN 'RECEIVED'
 WHEN EXISTS(SELECT 1 FROM supplier_order_lines l WHERE l."orderId"=o.id AND ${received}>0) THEN 'PARTIAL' ELSE 'SENT' END`;
export async function listSupplierOrders(db: PrismaClient, actor: Actor, p: { q: string; status: string; mine: boolean; overdue: boolean; page: number; partnerId?: number; creatorId?: number }) {
  const conditions = [Prisma.sql`TRUE`];
  if (p.q) conditions.push(Prisma.sql`(o.code ILIKE ${`%${p.q}%`} OR n.name ILIKE ${`%${p.q}%`} OR u."fullName" ILIKE ${`%${p.q}%`})`);
  if (p.status) conditions.push(Prisma.sql`${status}=${p.status}`);
  if (p.mine) conditions.push(Prisma.sql`o."createdBy"=${actor.userId}`);
  if (p.partnerId) conditions.push(Prisma.sql`o."partnerId"=${p.partnerId}`);
  if (p.creatorId) conditions.push(Prisma.sql`o."createdBy"=${p.creatorId}`);
  if (p.overdue) conditions.push(Prisma.sql`o.state='SENT' AND EXISTS(SELECT 1 FROM supplier_order_lines l WHERE l."orderId"=o.id AND l."expectedDate"<${ictYmd(new Date())}::date AND ${received}<l.qty)`);
  const from = Prisma.sql`FROM supplier_orders o JOIN partners n ON n.id=o."partnerId" JOIN users u ON u.id=o."createdBy" WHERE ${Prisma.join(conditions, " AND ")}`;
  const [counts, ids] = await Promise.all([
    db.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS total ${from}`),
    db.$queryRaw<{ id: number }[]>(Prisma.sql`SELECT o.id ${from} ORDER BY o.id DESC LIMIT 20 OFFSET ${(p.page - 1) * 20}`),
  ]);
  const rows = await db.supplierOrder.findMany({ where: { id: { in: ids.map(r => r.id) } }, omit: { attachments: true }, include: orderInclude, orderBy: { id: "desc" } });
  return { total: counts[0].total, rows };
}
