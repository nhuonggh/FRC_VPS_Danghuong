import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";
import { exportProductsXlsx, PRODUCT_FILTER_KEYS } from "@/server/products/queries";
export const dynamic = "force-dynamic";
export async function GET(req: Request) { try { await requireActorApi("product.view"); const params: Record<string, string[]> = {}; for (const [key, value] of new URL(req.url).searchParams) (params[key] ??= []).push(value); return xlsxResponse("san-pham.xlsx", await exportProductsXlsx(prisma, parseListParams(params, PRODUCT_FILTER_KEYS))); } catch (error) { return toErrorResponse(error); } }
