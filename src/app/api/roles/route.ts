import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { roleCreateSchema } from "@/server/roles/schemas";
import { createRoleIdempotent } from "@/server/roles/service";

/** Cùng Idempotency-Key gửi lại (mất phản hồi) → cùng `{ id }`, không 409 "tên đã tồn tại" (giống tạo người dùng). */
export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("role.manage");
  const key = readIdempotencyKey(req);
  const input = roleCreateSchema.parse(await readJson(req));
  return createRoleIdempotent(prisma, actor, key, input);
});
