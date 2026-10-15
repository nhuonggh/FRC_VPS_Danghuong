import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { ValidationError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { freightSchema, purchaseInputSchema } from "@/server/purchase/schemas";
import { updatePurchaseFreightTx, updatePurchaseTx } from "@/server/purchase/service";

export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("purchase.edit");
  const id = idParam.parse((await ctx.params).id);
  const raw = await readJson(req);
  const section = z.object({ section: z.string().optional() }).parse(raw).section;
  if (section === "content") return updatePurchaseTx(prisma, actor, id, purchaseInputSchema.parse(raw));
  if (section === "freight") { await updatePurchaseFreightTx(prisma, actor, id, freightSchema.parse(raw).freightCost); return { ok: true }; }
  throw new ValidationError("Phần dữ liệu không hợp lệ.");
});
