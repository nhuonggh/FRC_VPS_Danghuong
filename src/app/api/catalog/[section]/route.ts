import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readIdempotencyKey, readJson } from "@/server/http/read-json";
import { listCatalog } from "@/server/catalog/queries";
import { createCatalogItem } from "@/server/catalog/service";

export const GET = apiHandler(async (req, ctx: { params: Promise<{ section: string }> }) => {
  await requireActorApi("catalog.manage");
  const { section } = await ctx.params;
  return listCatalog(prisma, section, parseListParams(Object.fromEntries(req.nextUrl.searchParams), ["status"]));
});

export const POST = apiHandler(async (req, ctx: { params: Promise<{ section: string }> }) => {
  const actor = await requireActorApi("catalog.manage");
  readIdempotencyKey(req);
  const { section } = await ctx.params;
  const input = await readJson(req);
  return prisma.$transaction((tx) => createCatalogItem(tx, actor, section, input));
});
