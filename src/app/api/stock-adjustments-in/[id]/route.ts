import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { adjustmentInSchema, updateAdjustmentInTx } from "@/server/purchase/adjustment-in";
export const PUT = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => updateAdjustmentInTx(prisma, await requireActorApi("stock_adjust.manage"), idParam.parse((await ctx.params).id), adjustmentInSchema.parse(await readJson(req))));
