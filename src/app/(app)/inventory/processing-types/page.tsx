import { requireActor } from "@/server/auth/session";
import { CatalogListView, type CatalogSearchParams } from "../../system/catalog-settings/CatalogListView";

export default async function ProcessingTypesPage({ searchParams }: { searchParams: Promise<CatalogSearchParams> }) {
  await requireActor("catalog.manage");
  return <CatalogListView sectionKey="processing-types" sp={await searchParams} basePath="/inventory/processing-types" />;
}
