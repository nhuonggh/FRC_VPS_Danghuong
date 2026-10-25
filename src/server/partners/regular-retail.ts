import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { normalizePhone } from "@/lib/phone";
import { escapeLike, normalizeSearch } from "@/lib/search";
import { writeAudit } from "@/server/audit/write";
import { DomainError } from "@/server/http/errors";
import { nextPartnerCodesWithPrefix, REGULAR_RETAIL_PREFIX } from "./codes";

const searchTextOf = (code: string, name: string, phone: string) => normalizeSearch(`${code} ${name} ${phone}`);

/**
 * Khách lẻ thân quen: hồ sơ nhẹ (tên + SĐT). Có SĐT ⇒ nhận diện theo SĐT chuẩn hoá; chỉ có tên ⇒ nhận diện theo tên
 * (trùng tên không phân biệt hoa/thường với hồ sơ chưa có SĐT ⇒ dùng lại). Có rồi ⇒ dùng lại (giữ tên cũ); chưa có ⇒ tạo mới.
 * Nhóm khách do nơi gọi truyền vào (= nhóm của khách chung KHL ⇒ giá gợi ý "cùng nhóm" không đổi). Không cho ghi nợ (CHECK DB).
 */
export async function ensureRegularRetail(prisma: PrismaClient, v: { name: string; phone: string; groupId: number }): Promise<{ id: number; created: boolean }> {
  const key = normalizePhone(v.phone);
  const name = v.name.trim();
  if (v.phone.trim() && !key) throw new DomainError("Số điện thoại không hợp lệ (cần ít nhất 8 chữ số).", 400);
  if (!key && !name) throw new DomainError("Nhập tên hoặc số điện thoại của khách lẻ.", 400);
  const state = { id: true, isActive: true, mergedIntoId: true } as const;
  const find = () => key
    ? prisma.partner.findUnique({ where: { phoneKey: key }, select: state })
    : prisma.partner.findFirst({ where: { isRegularRetail: true, phoneKey: null, name: { equals: name, mode: "insensitive" } }, orderBy: { id: "asc" }, select: state });
  const usable = (p: { id: number; isActive: boolean; mergedIntoId: number | null }) => {
    if (!p.isActive || p.mergedIntoId !== null) throw new DomainError("Hồ sơ khách lẻ thân quen này đã bị tắt/gộp — hãy bật lại ở danh sách khách lẻ thân quen.", 409);
    return p.id;
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    const existing = await find();
    if (existing) return { id: usable(existing), created: false };
    try {
      const id = await prisma.$transaction(async (tx) => {
        const [code] = await nextPartnerCodesWithPrefix(tx, REGULAR_RETAIL_PREFIX, 1);
        const label = name || v.phone.trim();
        const phone = key ? v.phone.trim() : null;
        const row = await tx.partner.create({ data: { code: code!, name: label, searchText: searchTextOf(code!, label, phone ?? ""), groupId: v.groupId, isCustomer: true, allowCredit: false, phone, phoneKey: key || null, isRegularRetail: true } });
        return row.id;
      });
      return { id, created: true };
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // đua cùng SĐT/mã ⇒ thử lại
    }
  }
  throw new DomainError("Không tạo được hồ sơ khách lẻ thân quen, hãy thử lại.", 409);
}

export interface RegularRetailHit { id: number; code: string; name: string; phone: string | null }

/** Gợi ý khi gõ tên/SĐT ở form bán lẻ (người có `order.create`; không theo phạm vi "khách của mình"). */
export async function searchRegularRetail(prisma: PrismaClient, q: string, limit = 8): Promise<RegularRetailHit[]> {
  const terms = normalizeSearch(q).split(" ").filter(Boolean);
  if (!terms.length) return [];
  return prisma.partner.findMany({
    where: { isRegularRetail: true, isActive: true, mergedIntoId: null, AND: terms.map((t) => ({ searchText: { contains: escapeLike(t) } })) },
    orderBy: { name: "asc" }, take: limit, select: { id: true, code: true, name: true, phone: true },
  });
}

/** Nâng khách lẻ thân quen thành đối tác thường (cho phép đặt hạn mức/ghi nợ). Giữ mã, lịch sử. */
export async function promoteRegularRetail(db: Prisma.TransactionClient, actor: Actor, id: number): Promise<void> {
  assertCan(actor.perms, "partner.manage");
  const p = await db.partner.findFirst({ where: { id, isRegularRetail: true, mergedIntoId: null } });
  if (!p) throw new DomainError("Không phải khách lẻ thân quen.", 404);
  await db.partner.update({ where: { id }, data: { isRegularRetail: false, phoneKey: null } });
  await writeAudit(db, { userId: actor.userId, action: "partner.promote_regular_retail", entity: "Partner", entityId: id, before: { isRegularRetail: true }, after: { isRegularRetail: false } });
}
