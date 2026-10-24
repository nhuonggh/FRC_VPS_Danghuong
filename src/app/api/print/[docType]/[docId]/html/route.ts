import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { idParam } from "@/server/http/read-json";
import { toErrorResponse } from "@/server/http/handler";
import { buildHtmlPrint, renderHtmlPrint } from "@/server/print/html-document";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, ctx: { params: Promise<{ docType: string; docId: string }> }) {
  try {
    const actor = await requireActorApi("print.use");
    const p = await ctx.params;
    const sp = req.nextUrl.searchParams;
    const debt = sp.get("debt") === "1" ? true : sp.get("debt") === "0" ? false : undefined;
    const model = await buildHtmlPrint(prisma, actor, p.docType.toUpperCase(), idParam.parse(p.docId), { debt });
    const nonce = randomUUID();
    return new Response(renderHtmlPrint(model, req.nextUrl.searchParams.get("mode") !== "color", sp.get("auto") === "1", nonce, { hidePieces: sp.get("hidePieces") === "1", debt }), { headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' https:; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
    } });
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
