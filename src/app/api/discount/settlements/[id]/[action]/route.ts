import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { cancelSettlementSchema } from "@/server/discount/schemas";
import { cancelSettlementIdempotent, reconcileSettlementIdempotent } from "@/server/discount/settle";
import { DomainError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { idParam, readIdempotencyKey, readJson } from "@/server/http/read-json";

/** cancel (lý do bắt buộc, chỉ khi chưa hậu kiểm) · reconcile (hậu kiểm, quyền discount.reconcile). */
export const POST = apiHandler<{ params: Promise<{ id: string; action: string }> }>(async (req, ctx) => {
  const p = await ctx.params;
  const actor = await requireActorApi();
  const id = idParam.parse(p.id);
  if (p.action === "cancel") return cancelSettlementIdempotent(prisma, actor, readIdempotencyKey(req), id, cancelSettlementSchema.parse(await readJson(req)).reason);
  if (p.action === "reconcile") return reconcileSettlementIdempotent(prisma, actor, readIdempotencyKey(req), id);
  throw new DomainError("Thao tác không hợp lệ.", 404);
});
