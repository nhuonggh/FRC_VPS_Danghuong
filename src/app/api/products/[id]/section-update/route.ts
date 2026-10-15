import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { ValidationError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { basicSectionSchema, statusSectionSchema, stockSectionSchema, unitsSectionSchema } from "@/server/products/schemas";
import { setProductActive, setProductStock, setProductUnits, updateProductBasic } from "@/server/products/service";
export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => { const actor = await requireActorApi("product.manage"), id = idParam.parse((await ctx.params).id), raw = await readJson(req), section = z.object({ section: z.string().optional() }).parse(raw).section; await prisma.$transaction((tx) => { switch (section) { case "basic": return updateProductBasic(tx, actor, id, basicSectionSchema.parse(raw)); case "stock": return setProductStock(tx, actor, id, stockSectionSchema.parse(raw)); case "units": return setProductUnits(tx, actor, id, unitsSectionSchema.parse(raw)); case "status": return setProductActive(tx, actor, id, statusSectionSchema.parse(raw)); default: throw new ValidationError("Phần dữ liệu không hợp lệ."); } }); return { ok: true }; });
