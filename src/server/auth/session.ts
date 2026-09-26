import { cache } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { PermissionCode } from "@/lib/permissions/catalog";
import { ForbiddenError } from "@/lib/permissions/guard";
import { DomainError, UnauthorizedError } from "@/server/http/errors";
import { loadActor, type SessionActor } from "./actor";
import { toAuthMethod } from "./google";

/** Actor của request hiện tại (cache trong 1 request). Chưa đăng nhập/bị khoá → null. */
export const getActor = cache(async (): Promise<SessionActor | null> => {
  const session = await getServerSession(authOptions);
  const uid = session?.user?.id;
  if (!uid) return null;
  // amr từ JWT (do chính server ký) — chỉ đúng "google" mới được miễn bắt đổi mật khẩu
  return loadActor(prisma, uid, toAuthMethod(session?.user?.amr));
});

/** Dùng ở đầu mỗi page/layout/route: chưa đăng nhập → /login; thiếu quyền → /403. */
export async function requireActor(perm?: PermissionCode): Promise<SessionActor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (perm && !actor.perms.has(perm)) redirect("/403");
  return actor;
}

/**
 * Dùng trong route handler: trả 401/403 dạng JSON (qua apiHandler) thay vì redirect.
 * Tài khoản đang bị bắt đổi mật khẩu (mustChangePassword) bị 403 ở MỌI API — trừ route tự khai báo
 * `allowMustChange` (chỉ API đổi mật khẩu) — khớp với layout (app) chuyển hướng họ sang /change-password.
 * `actor.mustChangePassword` là giá trị CÓ HIỆU LỰC (actor.ts): phiên Google không bị chặn, phiên mật khẩu bị chặn.
 */
export async function requireActorApi(
  perm?: PermissionCode,
  opts: { allowMustChange?: boolean } = {},
): Promise<SessionActor> {
  const actor = await getActor();
  if (!actor) throw new UnauthorizedError();
  if (actor.mustChangePassword && !opts.allowMustChange) {
    throw new DomainError("Cần đổi mật khẩu trước khi tiếp tục.", 403, "MUST_CHANGE_PASSWORD");
  }
  if (perm && !actor.perms.has(perm)) throw new ForbiddenError(perm);
  return actor;
}
