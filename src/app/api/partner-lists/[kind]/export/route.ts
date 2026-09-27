import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";
import { parseKindParam } from "@/server/partners/kind-param";
import { exportPartnersXlsx, PARTNER_FILTER_KEYS } from "@/server/partners/queries";
export const dynamic = "force-dynamic";
export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) { try { const actor = await requireActorApi("partner.view"); const kind = parseKindParam((await ctx.params).kind); const params: Record<string, string[]> = {}; for (const [key, value] of new URL(req.url).searchParams) (params[key] ??= []).push(value); const file = await exportPartnersXlsx(prisma, actor, parseListParams(params, PARTNER_FILTER_KEYS), kind); return xlsxResponse(kind === "customer" ? "khach-hang.xlsx" : "nha-cung-cap.xlsx", file); } catch (error) { return toErrorResponse(error); } }
