import { notFound } from "next/navigation";
import { ModuleGuide } from "@/components/guide/GuideViews";
import { APP_NAV } from "@/config/app.config";
import { buildNav } from "@/lib/nav";
import { guideTopics } from "@/lib/user-guide";
import { requireActor } from "@/server/auth/session";

export default async function ModuleGuidePage({ params, searchParams }: {
  params: Promise<{ module: string }>;
  searchParams: Promise<{ topic?: string }>;
}) {
  const actor = await requireActor();
  const { module: key } = await params;
  const { topic } = await searchParams;
  const navModule = buildNav(APP_NAV, actor.perms).find((m) => m.key === key && m.type === "accordion");
  if (!navModule || !guideTopics(navModule).length) notFound();
  return <ModuleGuide module={navModule} topic={topic} />;
}
