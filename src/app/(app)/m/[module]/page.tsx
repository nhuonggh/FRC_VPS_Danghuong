import { notFound } from "next/navigation";
import { ModuleLanding } from "@/components/shell/ModuleLanding";
import { APP_NAV } from "@/config/app.config";
import { buildNav } from "@/lib/nav";
import { requireActor } from "@/server/auth/session";

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module: key } = await params;
  const actor = await requireActor();
  const navModule = buildNav(APP_NAV, actor.perms).find((m) => m.key === key && m.type === "accordion");
  if (!navModule) notFound(); // module không tồn tại HOẶC không có quyền: không lộ cấu trúc hệ thống
  return <ModuleLanding module={navModule} />;
}
