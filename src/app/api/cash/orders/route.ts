import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { listPartnerOrders } from "@/server/cash/queries";
import { apiHandler } from "@/server/http/handler";
import { idParam } from "@/server/http/read-json";

export const GET = apiHandler(async (req) => listPartnerOrders(prisma, await requireActorApi("cash.transaction.create"), idParam.parse(new URL(req.url).searchParams.get("partnerId"))));
