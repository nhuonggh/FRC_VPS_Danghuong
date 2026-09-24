import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getUser } from "@/server/users/queries";
import { UserDetail } from "./UserDetail";

const MAX_INT32 = 2_147_483_647;

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("user.view");
  const raw = (await params).id;
  const id = /^\d{1,10}$/.test(raw) ? Number(raw) : 0; // chỉ số nguyên dương thuần ("1e2", "0x10", "5abc" → 404)
  if (id <= 0 || id > MAX_INT32) notFound();
  const user = await getUser(prisma, id).catch((e) => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; });
  const [roles, history] = await Promise.all([
    prisma.role.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true } }),
    prisma.auditLog.findMany({ where: { entity: "User", entityId: String(id) }, orderBy: { id: "desc" }, take: 50, select: { id: true, action: true, at: true, userId: true } }),
  ]);
  const actorIds = [...new Set(history.map((h) => h.userId).filter((x): x is number => x !== null))];
  const names = new Map((await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
  return (
    <UserDetail
      user={{ ...user, createdAt: user.createdAt.toISOString() }}
      roles={roles}
      history={history.map((h) => ({ id: h.id, action: h.action, at: h.at.toISOString(), by: h.userId ? names.get(h.userId) ?? `#${h.userId}` : "Hệ thống" }))}
      canManage={actor.perms.has("user.manage")}
      isSelf={actor.userId === id}
    />
  );
}
