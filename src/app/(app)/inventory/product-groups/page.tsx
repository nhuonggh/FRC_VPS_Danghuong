import { CatalogListView, type CatalogSearchParams } from "../../system/catalog-settings/CatalogListView";

export default async function ProductGroupsPage({ searchParams }: { searchParams: Promise<CatalogSearchParams> }) {
  return <CatalogListView sectionKey="product-groups" sp={await searchParams} basePath="/inventory/product-groups" />;
}
