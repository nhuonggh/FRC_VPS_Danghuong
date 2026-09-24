import type { Prisma } from "@prisma/client";
import { can } from "./guard";

export interface Actor {
  userId: number;
  perms: ReadonlySet<string>;
}

/** Phạm vi dữ liệu khách hàng: thiếu partner.view_all → chỉ khách do mình phụ trách. */
export function partnerScopeWhere(actor: Actor): Prisma.PartnerWhereInput {
  return can(actor.perms, "partner.view_all") ? {} : { ownerUserId: actor.userId };
}
