import { notFound } from "next/navigation";
import { getSection } from "@/config/catalog-sections";
import { requireActor } from "@/server/auth/session";
import { CatalogForm } from "../../CatalogForm";

export default async function NewCatalogPage({ params }: { params: Promise<{ section: string }> }) {
  await requireActor("catalog.manage"); const section = getSection((await params).section); if (!section) notFound();
  return <CatalogForm section={section} />;
}
