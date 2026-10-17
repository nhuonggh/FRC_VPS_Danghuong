import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
export const GET = apiHandler(async () => {
 const actor = await requireActorApi("purchase.view");
 return prisma.supplierOrderNotice.findMany({ where: { userId: actor.userId, readAt: null }, take: 20, orderBy: { createdAt: "desc" }, select: { id: true, orderId: true, message: true, createdAt: true } });
});
export const POST = apiHandler(async () => {
 const actor = await requireActorApi("purchase.view");
 await prisma.supplierOrderNotice.updateMany({ where: { userId: actor.userId, readAt: null }, data: { readAt: new Date() } }); return { ok: true };
});
