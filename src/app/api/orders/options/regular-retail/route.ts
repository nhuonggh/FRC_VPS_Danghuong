import { prisma } from "@/lib/prisma";
import { assertCan } from "@/lib/permissions/guard";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { searchRegularRetail } from "@/server/partners/regular-retail";

export const dynamic = "force-dynamic";

/** Gợi ý khách lẻ thân quen (tên/SĐT) cho form bán lẻ — người lập đơn không cần quyền xem đối tác. */
export const GET = apiHandler(async (req) => {
  const actor = await requireActorApi();
  assertCan(actor.perms, "order.create");
  return searchRegularRetail(prisma, new URL(req.url).searchParams.get("q") ?? "");
});
