import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { cancelPurchaseSchema } from "@/server/purchase/schemas";
import { cancelAdjustmentInTx } from "@/server/purchase/adjustment-in";
export const POST = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => { await cancelAdjustmentInTx(prisma, await requireActorApi("stock_adjust.manage"), idParam.parse((await ctx.params).id), cancelPurchaseSchema.parse(await readJson(req)).reason); return { ok: true }; });
