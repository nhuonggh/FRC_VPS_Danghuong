import { prisma } from "@/lib/prisma";
import { prefsSchema } from "@/lib/workspace";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { readJson } from "@/server/http/read-json";
import { getPreferences, savePreferences } from "@/server/preferences/service";

export const dynamic = "force-dynamic";
/** Cấu hình giao diện của chính người đăng nhập (không cần quyền riêng: ai cũng có không gian làm việc của mình). */
export const GET = apiHandler(async () => { const actor = await requireActorApi(); return getPreferences(prisma, actor.userId); });
export const PUT = apiHandler(async (req) => { const actor = await requireActorApi(); const prefs = prefsSchema.parse(await readJson(req)); await savePreferences(prisma, actor.userId, prefs); return { ok: true }; });
