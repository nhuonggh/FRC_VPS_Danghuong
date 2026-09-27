import { notFound } from "next/navigation";
import { getSection } from "@/config/catalog-sections";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { getCatalogItem } from "@/server/catalog/queries";
import { CatalogForm } from "../../CatalogForm";

export default async function CatalogDetailPage({ params }: { params: Promise<{ section: string; id: string }> }) {
  await requireActor("catalog.manage"); const { section: key, id: rawId } = await params; const section = getSection(key); const id = Number(rawId); if (!section || !Number.isInteger(id) || id < 1) notFound();
  let row; try { row = await getCatalogItem(prisma, key, id); } catch { notFound(); }
  return <CatalogForm section={section} row={row} />;
}
