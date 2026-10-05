import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { listActiveOptions } from "@/server/catalog/queries";
import { canPrintDoc } from "@/server/print/types";
import { WALK_IN_CODE } from "./checkout";

/** Dữ liệu phụ cho form lập/sửa đơn bán: nhân viên bán, kho xuất, nhóm khách (để thêm nhanh khách), quyền in/thêm khách. */
export async function loadSaleFormOptions(prisma: PrismaClient, actor: Actor) {
  const canCreateCustomer = actor.perms.has("partner.manage");
  const canCollect = actor.perms.has("deposit.manage");
  const [users, warehouses, groups, cash, walkIn] = await Promise.all([
    prisma.user.findMany({ where: { isLocked: false }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    listActiveOptions(prisma, "warehouses"),
    canCreateCustomer ? listActiveOptions(prisma, "partner-groups") : Promise.resolve([]),
    canCollect ? prisma.cashAccount.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }) : Promise.resolve([]),
    prisma.partner.findUnique({ where: { code: WALK_IN_CODE }, select: { id: true } }),
  ]);
  return {
    currentUserId: actor.userId,
    salesUsers: users.map((u) => ({ value: u.id, label: u.fullName })),
    warehouses, groups, canCreateCustomer,
    /** Quỹ/tài khoản nhận tiền khi thu ngay (CASH = quỹ tiền mặt, BANK = ngân hàng). Rỗng khi thiếu quyền thu tiền. */
    cashAccounts: cash.map((c) => ({ value: c.id, label: c.name, type: c.type as "CASH" | "BANK" })),
    /** Id khách chung KHL (null = chưa được tạo; server tạo ở đơn khách lẻ đầu tiên) — dùng để gợi ý giá. */
    walkInPartnerId: walkIn?.id ?? null,
    canCollect, canPickup: actor.perms.has("order.edit"),
    canPrint: canPrintDoc(actor.perms, "SALE_INVOICE"),
  };
}
export type SaleFormOptions = Awaited<ReturnType<typeof loadSaleFormOptions>>;
