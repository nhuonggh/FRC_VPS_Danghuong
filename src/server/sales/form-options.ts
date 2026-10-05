import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { listActiveOptions } from "@/server/catalog/queries";
import { canPrintDoc } from "@/server/print/types";

/** Dữ liệu phụ cho form lập/sửa đơn bán: nhân viên bán, kho xuất, nhóm khách (để thêm nhanh khách), quyền in/thêm khách. */
export async function loadSaleFormOptions(prisma: PrismaClient, actor: Actor) {
  const canCreateCustomer = actor.perms.has("partner.manage");
  const [users, warehouses, groups] = await Promise.all([
    prisma.user.findMany({ where: { isLocked: false }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    listActiveOptions(prisma, "warehouses"),
    canCreateCustomer ? listActiveOptions(prisma, "partner-groups") : Promise.resolve([]),
  ]);
  return {
    currentUserId: actor.userId,
    salesUsers: users.map((u) => ({ value: u.id, label: u.fullName })),
    warehouses, groups, canCreateCustomer,
    canPrint: canPrintDoc(actor.perms, "SALE_INVOICE"),
  };
}
export type SaleFormOptions = Awaited<ReturnType<typeof loadSaleFormOptions>>;
