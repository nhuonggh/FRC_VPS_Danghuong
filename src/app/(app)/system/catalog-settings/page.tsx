import { requireActor } from "@/server/auth/session";
import { CatalogListView, type CatalogSearchParams } from "./CatalogListView";

export default async function CatalogSettingsPage({ searchParams }: { searchParams: Promise<CatalogSearchParams> }) {
  await requireActor("catalog.manage");
  const sp = await searchParams;
  return <CatalogListView sectionKey={typeof sp.section === "string" ? sp.section : undefined} sp={sp} />;
}
