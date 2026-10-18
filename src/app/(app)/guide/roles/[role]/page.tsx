import { notFound } from "next/navigation";
import { RoleGuide } from "@/components/guide/GuideViews";
import { APP_NAV } from "@/config/app.config";
import { GUIDE_ROLES } from "@/config/user-guide";
import { buildNav } from "@/lib/nav";
import { requireActor } from "@/server/auth/session";

export default async function RoleGuidePage({ params }: { params: Promise<{ role: string }> }) {
  const actor = await requireActor();
  const { role: key } = await params;
  const role = GUIDE_ROLES.find((item) => item.key === key);
  if (!role) notFound();
  return <RoleGuide role={role} nav={buildNav(APP_NAV, actor.perms)} />;
}
