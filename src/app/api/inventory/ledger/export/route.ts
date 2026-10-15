import { prisma } from "@/lib/prisma";
import { listTimeRange, parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { xlsxResponse } from "@/server/export/xlsx";
import { toErrorResponse } from "@/server/http/handler";
import { exportStockCardXlsx } from "@/server/inventory-reports/export";

const validId = (value: string | null) => !!value && /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 2_147_483_647;
export const dynamic = "force-dynamic";
export async function GET(req: Request) { try { const actor = await requireActorApi("stock.view"), url = new URL(req.url), product = url.searchParams.get("product"); if (!validId(product)) return new Response(JSON.stringify({ message: "Cần chọn sản phẩm để xuất thẻ kho." }), { status: 400, headers: { "content-type": "application/json" } }); const raw: Record<string, string[]> = {}; for (const [key, value] of url.searchParams) (raw[key] ??= []).push(value); const range = listTimeRange(parseListParams(raw)); return xlsxResponse("the-kho.xlsx", await exportStockCardXlsx(prisma, actor, Number(product), range?.start, range?.end)); } catch (error) { return toErrorResponse(error); } }
