import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { normalizeSearch } from "@/lib/search";
import { writeAudit } from "@/server/audit/write";
import { DomainError, FieldConflictError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { nextPartnerCodes } from "./codes";
import type { CreatePartnerInput } from "./schemas";

type Db = Prisma.TransactionClient;
export const searchTextOf = (p: { code: string; name: string; phone?: string | null }) => normalizeSearch(`${p.code} ${p.name} ${p.phone ?? ""}`);

async function assertGroupUsable(db: Db, groupId: number) {
  const group = await db.partnerGroup.findUnique({ where: { id: groupId } });
  if (!group) throw new DomainError("Nhóm khách hàng không hợp lệ.", 400);
  if (!group.isActive) throw new DomainError("Nhóm khách hàng đã tắt, hãy chọn nhóm khác.", 400);
}
async function assertOwnerUsable(db: Db, ownerUserId: number | null) {
  if (ownerUserId === null) return;
  const user = await db.user.findUnique({ where: { id: ownerUserId }, select: { isLocked: true } });
  if (!user || user.isLocked) throw new DomainError("Người phụ trách không hợp lệ.", 400);
}
async function loadEditable(db: Db, actor: Actor, id: number) {
  const partner = await db.partner.findFirst({ where: { id, mergedIntoId: null, ...partnerScopeWhere(actor) } });
  if (!partner) throw new DomainError("Không tìm thấy đối tác.", 404);
  return partner;
}
const codeTaken = () => new FieldConflictError("Mã đã tồn tại.", { code: "Mã đã tồn tại." });

export async function createPartner(db: Db, actor: Actor, input: CreatePartnerInput): Promise<{ id: number; code: string }> {
  assertCan(actor.perms, "partner.manage");
  await assertGroupUsable(db, input.groupId);
  // ASSUMPTION: Khi không chọn người phụ trách, người tạo chịu trách nhiệm để vẫn nhìn thấy bản ghi theo phạm vi "khách của mình".
  const ownerUserId = input.ownerUserId ?? actor.userId;
  await assertOwnerUsable(db, ownerUserId);
  const code = input.code !== "" ? input.code.toUpperCase() : (await nextPartnerCodes(db, input.isCustomer ? "customer" : "supplier", 1))[0]!;
  try {
    const row = await db.partner.create({ data: {
      code, name: input.name, searchText: searchTextOf({ code, name: input.name, phone: input.phone }),
      groupId: input.groupId, isCustomer: input.isCustomer, isSupplier: input.isSupplier, ownerUserId,
      debtLimit: new Prisma.Decimal(input.debtLimit), allowCredit: input.allowCredit,
      phone: input.phone || null, address: input.address || null, note: input.note || null, isActive: input.isActive,
    } });
    await writeAudit(db, { userId: actor.userId, action: "partner.create", entity: "Partner", entityId: row.id, after: {
      code, name: row.name, groupId: row.groupId, isCustomer: row.isCustomer, isSupplier: row.isSupplier,
      debtLimit: row.debtLimit.toString(), allowCredit: row.allowCredit,
    } });
    return { id: row.id, code };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw codeTaken();
    throw error;
  }
}

export async function createPartnerIdempotent(prisma: PrismaClient, actor: Actor, key: string, input: CreatePartnerInput) {
  assertCan(actor.perms, "partner.manage");
  return withIdempotency(prisma, { userId: actor.userId, scope: "partner.create", key }, (tx) => createPartner(tx, actor, input));
}

export async function updatePartnerProfile(db: Db, actor: Actor, id: number, v: { name: string; groupId: number; isCustomer: boolean; isSupplier: boolean; phone: string; address: string; note: string }) {
  assertCan(actor.perms, "partner.manage");
  const before = await loadEditable(db, actor, id);
  if (v.groupId !== before.groupId) await assertGroupUsable(db, v.groupId);
  await db.partner.update({ where: { id }, data: { name: v.name, searchText: searchTextOf({ code: before.code, name: v.name, phone: v.phone }), groupId: v.groupId, isCustomer: v.isCustomer, isSupplier: v.isSupplier, phone: v.phone || null, address: v.address || null, note: v.note || null } });
  await writeAudit(db, { userId: actor.userId, action: "partner.update_profile", entity: "Partner", entityId: id, before: { name: before.name, groupId: before.groupId, isCustomer: before.isCustomer, isSupplier: before.isSupplier, phone: before.phone, address: before.address, note: before.note }, after: { name: v.name, groupId: v.groupId, isCustomer: v.isCustomer, isSupplier: v.isSupplier, phone: v.phone || null, address: v.address || null, note: v.note || null } });
}
export async function setPartnerCredit(db: Db, actor: Actor, id: number, v: { debtLimit: number; allowCredit: boolean }) {
  assertCan(actor.perms, "partner.manage"); const before = await loadEditable(db, actor, id);
  await db.partner.update({ where: { id }, data: { debtLimit: new Prisma.Decimal(v.debtLimit), allowCredit: v.allowCredit } });
  await writeAudit(db, { userId: actor.userId, action: "partner.set_credit", entity: "Partner", entityId: id, before: { debtLimit: before.debtLimit.toString(), allowCredit: before.allowCredit }, after: { debtLimit: String(v.debtLimit), allowCredit: v.allowCredit } });
}
export async function setPartnerOwner(db: Db, actor: Actor, id: number, v: { ownerUserId: number | null }) {
  assertCan(actor.perms, "partner.manage"); const before = await loadEditable(db, actor, id); await assertOwnerUsable(db, v.ownerUserId);
  await db.partner.update({ where: { id }, data: { ownerUserId: v.ownerUserId } });
  await writeAudit(db, { userId: actor.userId, action: "partner.set_owner", entity: "Partner", entityId: id, before: { ownerUserId: before.ownerUserId }, after: { ownerUserId: v.ownerUserId } });
}
export async function setPartnerActive(db: Db, actor: Actor, id: number, v: { isActive: boolean }) {
  assertCan(actor.perms, "partner.manage"); const before = await loadEditable(db, actor, id); if (before.isActive === v.isActive) return;
  await db.partner.update({ where: { id }, data: { isActive: v.isActive } });
  await writeAudit(db, { userId: actor.userId, action: "partner.set_active", entity: "Partner", entityId: id, before: { isActive: before.isActive }, after: { isActive: v.isActive } });
}
