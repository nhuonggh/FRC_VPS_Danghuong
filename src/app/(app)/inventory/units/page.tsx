import { CatalogListView, type CatalogSearchParams } from "../../system/catalog-settings/CatalogListView";

export default async function UnitsPage({ searchParams }: { searchParams: Promise<CatalogSearchParams> }) {
  return <CatalogListView sectionKey="units" sp={await searchParams} basePath="/inventory/units" />;
}
