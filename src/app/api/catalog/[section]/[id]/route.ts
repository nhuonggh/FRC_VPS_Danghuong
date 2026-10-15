import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { getCatalogItem } from "@/server/catalog/queries";
import { deleteCatalogItem, updateCatalogItem } from "@/server/catalog/service";

export const GET = apiHandler(async (_req, ctx: { params: Promise<{ section: string; id: string }> }) => {
  await requireActorApi("catalog.manage");
  const { section, id: rawId } = await ctx.params;
  return getCatalogItem(prisma, section, idParam.parse(rawId));
});

export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ section: string; id: string }> }) => {
  const actor = await requireActorApi("catalog.manage");
  const { section, id: rawId } = await ctx.params;
  const input = await readJson(req);
  await prisma.$transaction((tx) => updateCatalogItem(tx, actor, section, idParam.parse(rawId), input));
  return { ok: true };
});

export const DELETE = apiHandler(async (_req, ctx: { params: Promise<{ section: string; id: string }> }) => {
  const actor = await requireActorApi("catalog.manage");
  const { section, id: rawId } = await ctx.params;
  await prisma.$transaction((tx) => deleteCatalogItem(tx, actor, section, idParam.parse(rawId)));
  return { ok: true };
});
