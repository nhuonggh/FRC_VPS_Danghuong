import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";
import { idParam, readJson } from "@/server/http/read-json";
import { deleteDraftOrder, editSaleOrderTx } from "@/server/sales/lifecycle";
import { saleOrderSchema } from "@/server/sales/schemas";

/** Sửa đơn (kỳ đang mở): gỡ và ghi lại dòng xuất kho trong một giao dịch, tính lại chuỗi giá vốn. */
export const PATCH = apiHandler(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("order.edit");
  const id = idParam.parse((await ctx.params).id);
  return editSaleOrderTx(prisma, actor, id, saleOrderSchema.parse(await readJson(req)));
});

/** Xóa hẳn đơn NHÁP (34c). Đơn đã xác nhận không xóa được — dùng Hủy đơn. */
export const DELETE = apiHandler(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const actor = await requireActorApi("order.delete_draft");
  const id = idParam.parse((await ctx.params).id);
  await prisma.$transaction((tx) => deleteDraftOrder(tx, actor, id));
  return { ok: true };
});
