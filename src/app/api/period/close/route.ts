import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { confirmClose, confirmCloseSchema } from "@/server/closing/service";
import { apiHandler } from "@/server/http/handler";
import { readJson } from "@/server/http/read-json";

/** Kết sổ kỳ đang mở (bước 2). Quyền `period.close`; chống bấm đôi do khoá dòng kỳ ở engine, không dùng Idempotency-Key. */
export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("period.close");
  const result = await confirmClose(prisma, actor, confirmCloseSchema.parse(await readJson(req)));
  return { closedPeriodId: result.closedPeriodId, newPeriod: result.newPeriod, carried: result.carried };
}, { noStore: true });
