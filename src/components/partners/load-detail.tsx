import { notFound } from "next/navigation";
import { listActiveOptions } from "@/server/catalog/queries";
import type { Actor } from "@/lib/permissions/scope";
import { prisma } from "@/lib/prisma";
import { DomainError } from "@/server/http/errors";
import type { PartnerKind } from "@/server/partners/codes";
import { getPartner } from "@/server/partners/queries";
import { PartnerDetail } from "./PartnerDetail";
const MAX_INT32 = 2_147_483_647;
export async function loadPartnerDetail(kind: PartnerKind, actor: Actor, rawId: string) {
  const id = /^\d{1,10}$/.test(rawId) ? Number(rawId) : 0; if (id <= 0 || id > MAX_INT32) notFound();
  const partner = await getPartner(prisma, actor, id, kind).catch((error) => { if (error instanceof DomainError && error.status === 404) notFound(); throw error; });
  const [groupOptions, users, history, mergedInto] = await Promise.all([listActiveOptions(prisma, "partner-groups"), prisma.user.findMany({ where: { isLocked: false }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }), prisma.auditLog.findMany({ where: { entity: "Partner", entityId: String(id) }, orderBy: { id: "desc" }, take: 50, select: { id: true, action: true, at: true, userId: true } }), partner.mergedIntoId ? prisma.partner.findUnique({ where: { id: partner.mergedIntoId }, select: { id: true, code: true } }) : Promise.resolve(null)]);
  const groups = groupOptions.some((g) => g.value === partner.groupId) ? groupOptions : [...groupOptions, { value: partner.groupId, label: partner.groupName }]; const ids = [...new Set(history.map((row) => row.userId).filter((id): id is number => id !== null))]; const nameById = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })).map((user) => [user.id, user.fullName]));
  return <PartnerDetail kind={kind} partner={JSON.parse(JSON.stringify(partner))} groups={groups} owners={users.map((user) => ({ value: user.id, label: user.fullName }))} history={history.map((row) => ({ id: row.id, action: row.action, at: row.at.toISOString(), by: row.userId ? nameById.get(row.userId) ?? `#${row.userId}` : "Hệ thống" }))} canManage={actor.perms.has("partner.manage") && !partner.mergedIntoId} canAssign={actor.perms.has("partner.view_all")} mergedInto={mergedInto} />;
}
