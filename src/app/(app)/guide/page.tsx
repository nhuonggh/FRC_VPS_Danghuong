import { GuideIndex } from "@/components/guide/GuideViews";
import { APP_NAV } from "@/config/app.config";
import { buildNav } from "@/lib/nav";
import { requireActor } from "@/server/auth/session";

export default async function GuidePage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const actor = await requireActor();
  const { view } = await searchParams;
  return <GuideIndex nav={buildNav(APP_NAV, actor.perms)} view={view === "roles" || view === "faq" ? view : "functions"} />;
}
