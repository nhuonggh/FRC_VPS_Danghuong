import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { z } from "zod";
export const GET = apiHandler(async req => {
 await requireActorApi("purchase.view"); await requireActorApi("purchase_price.view");
 const partnerId = z.coerce.number().int().positive().parse(req.nextUrl.searchParams.get("partnerId"));
 const productId = z.coerce.number().int().positive().parse(req.nextUrl.searchParams.get("productId"));
 const line = await prisma.purchaseLine.findFirst({ where: { productId, purchase: { partnerId, isCancelled: false } }, orderBy: [{ purchase: { at: "desc" } }, { id: "desc" }], include: { purchase: { select: { at: true } } } });
 return line ? { price: line.purchasePrice.toString(), unit: line.unit, at: line.purchase.at } : null;
});
