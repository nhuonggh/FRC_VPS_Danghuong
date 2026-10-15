import { requireActorApi } from "@/server/auth/session";
import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/server/http/handler";
import { reviewSchema, updateDailyReview } from "@/server/home/daily-review";

export const dynamic = "force-dynamic";
export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi();
  return updateDailyReview(prisma, actor, reviewSchema.parse(await req.json()));
}, { noStore: true });
