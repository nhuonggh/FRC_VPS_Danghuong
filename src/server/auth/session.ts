import { cache } from "react";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { PermissionCode } from "@/lib/permissions/catalog";
import { loadActor, type SessionActor } from "./actor";

/** Actor của request hiện tại (cache trong 1 request). Chưa đăng nhập/bị khoá → null. */
export const getActor = cache(async (): Promise<SessionActor | null> => {
  const session = await getServerSession(authOptions);
  const uid = session?.user?.id;
  if (!uid) return null;
  return loadActor(prisma, uid);
});

/** Dùng ở đầu mỗi page/layout/route: chưa đăng nhập → /login; thiếu quyền → /403. */
export async function requireActor(perm?: PermissionCode): Promise<SessionActor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (perm && !actor.perms.has(perm)) redirect("/403");
  return actor;
}
