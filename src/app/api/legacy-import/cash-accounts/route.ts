import { prisma } from "@/lib/prisma";
import { requireActorApi } from "@/server/auth/session";
import { apiHandler } from "@/server/http/handler";

export const dynamic = "force-dynamic";

/** Quỹ/tài khoản đang dùng để chọn nơi nhận tiền khi nhập đơn từ phần mềm cũ; kèm cờ quyền để form mờ tùy chọn không dùng được. */
export const GET = apiHandler(async () => {
  const actor = await requireActorApi("order.create");
  const accounts = await prisma.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true } });
  return { accounts, canReceipt: actor.perms.has("deposit.manage"), canDeliver: actor.perms.has("order.edit") };
});
