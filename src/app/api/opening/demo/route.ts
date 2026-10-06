import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readJson } from "@/server/http/read-json";
import { loadDemoOpening, resetDemoOpening } from "@/server/opening/demo";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["load", "reset"]) });

/** Nạp / reset SỐ DEMO đầu kỳ (công nợ, tồn kho, quỹ, chiết khấu). Chỉ giám đốc (period.close — kiểm trong service). */
export const POST = apiHandler(async (req) => {
  const actor = await requireActorApi("data.import");
  const { action } = bodySchema.parse(await readJson(req));
  return action === "load" ? loadDemoOpening(prisma, actor) : resetDemoOpening(prisma, actor);
});
