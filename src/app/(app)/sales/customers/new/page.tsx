import { PartnerNewForm } from "@/components/partners/PartnerNewForm";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { listActiveOptions } from "@/server/catalog/queries";
export default async function NewCustomerPage() { const actor = await requireActor("partner.manage"), canPickOwner = actor.perms.has("partner.view_all"); const [groups, users] = await Promise.all([listActiveOptions(prisma, "partner-groups"), canPickOwner ? prisma.user.findMany({ where: { isLocked: false }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }) : Promise.resolve([])]); return <PartnerNewForm kind="customer" groups={groups} owners={users.map((user) => ({ value: user.id, label: user.fullName }))} canPickOwner={canPickOwner} />; }
