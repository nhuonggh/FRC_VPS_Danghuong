import { CompanyDetail } from "@/components/company/CompanyDetail";
import { prisma } from "@/lib/prisma";
import { getCompany, listPrintTemplates } from "@/server/company/queries";
import { requireActor } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function CompanyPage() {
  await requireActor("company.manage");
  const [company, templates] = await Promise.all([getCompany(prisma), listPrintTemplates(prisma)]);
  return <CompanyDetail company={company} templates={templates} />;
}
