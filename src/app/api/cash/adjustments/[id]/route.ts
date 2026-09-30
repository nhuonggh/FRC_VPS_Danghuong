import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { decideAdjustmentIdempotent } from "@/server/cash/adjust";
import { decideAdjustmentSchema } from "@/server/cash/schemas";
import { apiHandler } from "@/server/http/handler";
import { idParam, readIdempotencyKey, readJson } from "@/server/http/read-json";

/** Thủ quỹ duyệt / từ chối yêu cầu điều chỉnh. */
export const POST = apiHandler<{ params: Promise<{ id: string }> }>(async (req, ctx) =>
  decideAdjustmentIdempotent(prisma, await requireActorApi("cash.adjust.approve"), readIdempotencyKey(req), idParam.parse((await ctx.params).id), decideAdjustmentSchema.parse(await readJson(req))),
);
