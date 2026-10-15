import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { listActiveOptions } from "@/server/catalog/queries";
import { apiHandler } from "@/server/http/handler";

export const dynamic = "force-dynamic";

/** Quỹ/tài khoản nhận tiền cọc: người thu không cần quyền quản trị danh mục. */
export const GET = apiHandler(async () => {
  await requireActorApi("deposit.manage");
  return listActiveOptions(prisma, "cash-accounts");
});
