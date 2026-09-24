import { notFound } from "next/navigation";
import { PERMISSIONS, type PermissionDef } from "@/lib/permissions/catalog";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { getRole } from "@/server/roles/queries";
import { RoleDetail } from "./RoleDetail";

const MAX_INT32 = 2_147_483_647;

export default async function RoleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor("role.manage");
  const raw = (await params).id;
  const id = /^\d{1,10}$/.test(raw) ? Number(raw) : 0; // chỉ số nguyên dương thuần
  if (id <= 0 || id > MAX_INT32) notFound();
  const role = await getRole(prisma, id).catch((e) => { if (e instanceof DomainError && e.status === 404) notFound(); throw e; });
  const catalog = (PERMISSIONS as readonly PermissionDef[]).map((p) => ({ code: p.code, label: p.label, group: p.group, sensitive: p.sensitive ?? false }));
  return <RoleDetail role={role} catalog={catalog} actorPerms={[...actor.perms]} canViewUsers={actor.perms.has("user.view")} />;
}
