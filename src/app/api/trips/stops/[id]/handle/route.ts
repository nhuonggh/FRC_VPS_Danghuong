import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { handleStopSchema } from "@/server/trips/schemas";
import { handleStop } from "@/server/trips/service";

/** Hàng không giao được (42): ghi nhận người bán đã xử lý. */
export const POST = apiHandler<{ params: Promise<{ id: string }> }>(async (req, ctx) => {
  const actor = await requireActorApi("trip.manage");
  const id = idParam.parse((await ctx.params).id);
  const { note } = handleStopSchema.parse(await readJson(req));
  await prisma.$transaction((tx) => handleStop(tx, actor, id, note));
  return { id };
});
