import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { listActiveOptions } from "@/server/catalog/queries";
import { apiHandler } from "@/server/http/handler";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  await requireActorApi("bom.manage");
  return listActiveOptions(prisma, "processing-types");
});
