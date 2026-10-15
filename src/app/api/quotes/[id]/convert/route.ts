import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam } from "@/server/http/read-json";
import { convertQuote } from "@/server/quotes/service";

/** Chuyển báo giá thành ĐƠN NHÁP (không đụng kho). Xác nhận đơn nháp mới xuất kho. */
export const POST = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("quote.manage");
  const id = idParam.parse((await ctx.params).id);
  return prisma.$transaction((tx) => convertQuote(tx, actor, id));
});
