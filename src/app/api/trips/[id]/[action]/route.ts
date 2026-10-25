import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { DomainError } from "@/server/http/errors";
import { apiHandler } from "@/server/http/handler";
import { idParam, readIdempotencyKey, readJson } from "@/server/http/read-json";
import { cancelTripSchema, confirmTripSchema, removeTripExpenseSchema, settleTripSchema, tripExpenseSchema, tripResultSchema } from "@/server/trips/schemas";
import { addTripExpense, cancelTrip, clearTripResult, confirmTripCashIdempotent, departTrip, recordTripResultIdempotent, removeTripExpense, settleTripIdempotent } from "@/server/trips/service";

/** Hành động trên chuyến: depart · cancel · result · clear-result · expense-add/expense-remove (chi phí lái xe ứng) · settle (đối soát) · confirm (thủ quỹ nhận tiền). Quyền kiểm ở service. */
export const POST = apiHandler<{ params: Promise<{ id: string; action: string }> }>(async (req, ctx) => {
  const p = await ctx.params;
  const actor = await requireActorApi();
  const id = idParam.parse(p.id);
  switch (p.action) {
    case "depart": await prisma.$transaction((tx) => departTrip(tx, actor, id)); return { id };
    case "cancel": { const { reason } = cancelTripSchema.parse(await readJson(req)); await prisma.$transaction((tx) => cancelTrip(tx, actor, id, reason)); return { id }; }
    case "result": return recordTripResultIdempotent(prisma, actor, readIdempotencyKey(req), id, tripResultSchema.parse(await readJson(req)));
    case "clear-result": { const { orderId } = z.object({ orderId: idParam }).parse(await readJson(req)); await prisma.$transaction((tx) => clearTripResult(tx, actor, id, orderId)); return { id }; }
    case "expense-add": { const input = tripExpenseSchema.parse(await readJson(req)); return prisma.$transaction((tx) => addTripExpense(tx, actor, id, input)); }
    case "expense-remove": { const { expenseId } = removeTripExpenseSchema.parse(await readJson(req)); await prisma.$transaction((tx) => removeTripExpense(tx, actor, id, expenseId)); return { id }; }
    case "settle": return settleTripIdempotent(prisma, actor, readIdempotencyKey(req), id, settleTripSchema.parse(await readJson(req)).reason);
    case "confirm": return confirmTripCashIdempotent(prisma, actor, readIdempotencyKey(req), id, confirmTripSchema.parse(await readJson(req)));
    default: throw new DomainError("Thao tác không hợp lệ.", 404);
  }
});
