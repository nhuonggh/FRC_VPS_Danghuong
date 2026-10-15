import { prisma } from "@/lib/prisma";
import { getCompany, listPrintTemplates } from "@/server/company/queries";
import { updateCompanySchema } from "@/server/company/schemas";
import { updateCompany } from "@/server/company/service";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readJson } from "@/server/http/read-json";

export const dynamic = "force-dynamic";

// no-store: cấu hình công ty và danh sách mẫu in không được proxy/trình duyệt lưu bản sao
export const GET = apiHandler(async () => {
  await requireActorApi("company.manage");
  const [company, templates] = await Promise.all([getCompany(prisma), listPrintTemplates(prisma)]);
  return { company, templates };
}, { noStore: true });

export const PATCH = apiHandler(async (req) => {
  const actor = await requireActorApi("company.manage");
  const input = updateCompanySchema.parse(await readJson(req));
  return prisma.$transaction((tx) => updateCompany(tx, actor, input));
}, { noStore: true });
