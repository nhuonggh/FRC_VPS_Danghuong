import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { voidCashCloseIdempotent } from "@/server/cash/close";
import { reasonSchema } from "@/server/cash/schemas";
import { apiHandler } from "@/server/http/handler";
import { idParam, readIdempotencyKey, readJson } from "@/server/http/read-json";

/** Hủy một lần chốt quỹ (quyền cash.close.reopen, lý do bắt buộc). */
export const DELETE = apiHandler<{ params: Promise<{ id: string }> }>(async (req, ctx) =>
  voidCashCloseIdempotent(prisma, await requireActorApi("cash.close.reopen"), readIdempotencyKey(req), idParam.parse((await ctx.params).id), reasonSchema.parse(await readJson(req)).reason),
);
