import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { createUserSchema } from "@/server/users/schemas";
import { createUserIdempotent } from "@/server/users/service";

/**
 * Mật khẩu tạm KHÔNG đi qua bảng idempotency (D-10): lần đầu trả `tempPassword`; lặp lại cùng
 * Idempotency-Key → cùng `id`, `tempPassword: null` (UI nhắc dùng "Cấp lại mật khẩu").
 */
export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("user.manage");
  const key = readIdempotencyKey(req);
  const input = createUserSchema.parse(await readJson(req));
  return createUserIdempotent(prisma, actor, key, input);
}, { noStore: true }); // phản hồi mang mật khẩu tạm
