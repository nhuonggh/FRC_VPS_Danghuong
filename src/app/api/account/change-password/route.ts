import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readJson } from "@/server/http/read-json";
import { changePasswordSchema } from "@/server/users/schemas";
import { changeOwnPassword } from "@/server/users/service";

export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi(undefined, { allowMustChange: true }); // chỉ cần đã đăng nhập; API DUY NHẤT dùng được khi bị bắt đổi mật khẩu
  const v = changePasswordSchema.parse(await readJson(req));
  await prisma.$transaction((tx) => changeOwnPassword(tx, actor, { current: v.current, next: v.next }));
  return { ok: true };
});
