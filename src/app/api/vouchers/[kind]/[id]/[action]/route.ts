import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { requestAdjustmentIdempotent } from "@/server/cash/adjust";
import { adjustmentRequestSchema, reasonSchema } from "@/server/cash/schemas";
import { parseVoucherKind, voucherPerm } from "@/server/cash/route-helpers";
import { cancelVoucher, returnVoucherIdempotent, reviewVoucherIdempotent } from "@/server/cash/vouchers";
import { DomainError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { idParam, readIdempotencyKey, readJson } from "@/server/http/read-json";

/** Hành động trên phiếu: cancel (chưa kiểm) · review / return (thủ quỹ) · adjust (yêu cầu điều chỉnh phiếu đã kiểm). */
export const POST = apiHandler<{ params: Promise<{ kind: string; id: string; action: string }> }>(async (req, ctx) => {
  const p = await ctx.params;
  const doc = parseVoucherKind(p.kind);
  const actor = await requireActorApi(voucherPerm(doc));
  const id = idParam.parse(p.id);
  switch (p.action) {
    case "cancel": { const { reason } = reasonSchema.parse(await readJson(req)); await prisma.$transaction((tx) => cancelVoucher(tx, actor, doc, id, reason)); return { id }; }
    case "review": return reviewVoucherIdempotent(prisma, actor, readIdempotencyKey(req), doc, id);
    case "return": { const { reason } = reasonSchema.parse(await readJson(req)); return returnVoucherIdempotent(prisma, actor, readIdempotencyKey(req), doc, id, reason); }
    case "adjust": return requestAdjustmentIdempotent(prisma, actor, readIdempotencyKey(req), doc, id, adjustmentRequestSchema.parse(await readJson(req)));
    default: throw new DomainError("Thao tác không hợp lệ.", 404);
  }
});
