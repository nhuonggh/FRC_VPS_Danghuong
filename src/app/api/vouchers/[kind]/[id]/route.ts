import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { paymentSchema, receiptSchema } from "@/server/cash/schemas";
import { parseVoucherKind } from "@/server/cash/route-helpers";
import { editPayment, editReceipt } from "@/server/cash/vouchers";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";

/** Sửa phiếu CHƯA kiểm tra (hoặc bị trả lại) — sửa xong tự gửi lại. */
export const PATCH = apiHandler<{ params: Promise<{ kind: string; id: string }> }>(async (req, ctx) => {
  const p = await ctx.params;
  const doc = parseVoucherKind(p.kind);
  const actor = await requireActorApi();
  const id = idParam.parse(p.id);
  const body = await readJson(req);
  await prisma.$transaction((tx) => (doc === "RECEIPT" ? editReceipt(tx, actor, id, receiptSchema.parse(body)) : editPayment(tx, actor, id, paymentSchema.parse(body))));
  return { id };
});
