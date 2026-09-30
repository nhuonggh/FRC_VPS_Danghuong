import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { stocktakeSchema } from "@/server/stocktake/schemas";
import { updateStocktake } from "@/server/stocktake/service";

export const PUT = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => updateStocktake(prisma, await requireActorApi("stocktake.manage"), idParam.parse((await ctx.params).id), stocktakeSchema.parse(await readJson(req))));
