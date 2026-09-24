import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readJson } from "@/server/http/read-json";
import { changePasswordSchema } from "@/server/users/schemas";
import { changeOwnPassword } from "@/server/users/service";

export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi(); // chỉ cần đã đăng nhập
  const v = changePasswordSchema.parse(await readJson(req));
  await prisma.$transaction((tx) => changeOwnPassword(tx, actor, { current: v.current, next: v.next }));
  return { ok: true };
});
