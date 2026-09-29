import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { listActiveOptions } from "@/server/catalog/queries";
import { apiHandler } from "@/server/http/handler";

export const dynamic = "force-dynamic";

/** Kiểu gia công cho dòng bán (tôn xốp…): người bán không cần quyền quản trị danh mục. */
export const GET = apiHandler(async () => {
  await requireActorApi("order.create");
  return listActiveOptions(prisma, "processing-types");
});
