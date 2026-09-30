import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam } from "@/server/http/read-json";
import { getLastPrint, printDocument } from "@/server/print/service";

type Ctx = { params: Promise<{ docType: string; docId: string }> };

/** Tạo bản in qua Apps Script (in lại ⇒ thay bản cũ). */
export const POST = apiHandler<Ctx>(async (_req, ctx) => {
  const p = await ctx.params;
  return printDocument(prisma, await requireActorApi("print.use"), p.docType.toUpperCase(), idParam.parse(p.docId));
});

/** Bản in gần nhất của chứng từ (hoặc null). */
export const GET = apiHandler<Ctx>(async (_req, ctx) => {
  const p = await ctx.params;
  return { last: await getLastPrint(prisma, await requireActorApi("print.use"), p.docType.toUpperCase(), idParam.parse(p.docId)) };
});
