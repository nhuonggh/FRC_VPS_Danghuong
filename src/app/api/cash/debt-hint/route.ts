import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { partnerDebtHint } from "@/server/cash/queries";
import { apiHandler } from "@/server/http/handler";
import { idParam } from "@/server/http/read-json";

export const GET = apiHandler(async (req) => partnerDebtHint(prisma, await requireActorApi("cash.transaction.create"), idParam.parse(new URL(req.url).searchParams.get("partnerId"))));
