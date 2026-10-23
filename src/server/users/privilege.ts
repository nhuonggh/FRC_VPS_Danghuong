import type { Prisma } from "@prisma/client";
import { PERMISSIONS } from "@/lib/permissions/catalog";
import type { Actor } from "@/lib/permissions/scope";
import { unionPermissionCodes } from "@/server/auth/actor";
import { DomainError } from "@/server/http/errors";

/**
 * KHÔNG LEO THANG ĐẶC QUYỀN (mặc định an toàn, cần khách xác nhận — xem docs/conventions/permissions.md):
 * không ai được cấp hoặc tác động lên thứ vượt quá quyền hiệu lực (HỢP các nhóm) của CHÍNH MÌNH.
 * Giám đốc giữ mọi quyền nên không bao giờ bị chặn. Các hàm này chạy TRONG transaction của service,
 * TRƯỚC mọi thao tác ghi và trước bất biến "còn quản trị viên".
 */
type Db = Prisma.TransactionClient;

const LABELS = new Map<string, string>(PERMISSIONS.map((p) => [p.code, p.label]));
const describe = (code: string) => `${LABELS.get(code) ?? code} (${code})`;

const forbidden = (message: string) => new DomainError(message, 403, "FORBIDDEN");

/** Quyền hiệu lực của một tài khoản = HỢP quyền của mọi nhóm nó đang giữ (cùng hàm với loadActor). */
export async function permsOfUser(db: Db, userId: number): Promise<Set<string>> {
  const roles = await db.role.findMany({
    where: { users: { some: { userId } } },
    include: { permissions: { include: { permission: true } } },
  });
  return unionPermissionCodes(roles);
}

/** Quyền của một tập nhóm (HỢP). */
export async function permsOfRoles(db: Db, roleIds: readonly number[]): Promise<Set<string>> {
  const roles = await db.role.findMany({
    where: { id: { in: [...roleIds] } },
    include: { permissions: { include: { permission: true } } },
  });
  return unionPermissionCodes(roles);
}

/** Mọi quyền trong `wanted` phải nằm trong quyền của người thực hiện; ngược lại → 403. */
export function assertCanGrant(actorPerms: ReadonlySet<string>, wanted: Iterable<string>): void {
  const missing = [...new Set(wanted)].filter((c) => !actorPerms.has(c)).sort();
  if (missing.length > 0) {
    throw forbidden(`Bạn không thể cấp quyền mà chính bạn không có: ${missing.map(describe).join(", ")}.`);
  }
}

/**
 * Tác động (đặt lại mật khẩu, khoá/mở khoá, đổi họ tên/vai trò) lên tài khoản khác chỉ được khi quyền của
 * tài khoản đó ⊆ quyền của mình; nếu không, người có ít quyền hơn có thể chiếm hoặc vô hiệu hoá tài khoản mạnh hơn.
 * Đồng thời chặn gỡ/thay các nhóm cao hơn mình (đối tượng đang giữ chúng thì ⊄ quyền của mình).
 */
export async function assertCanAffectUser(db: Db, actor: Actor, targetUserId: number): Promise<void> {
  if (targetUserId === actor.userId) return; // quyền của chính mình luôn ⊆ quyền của mình
  const target = await permsOfUser(db, targetUserId);
  const missing = [...target].filter((c) => !actor.perms.has(c)).sort();
  if (missing.length > 0) {
    throw forbidden(`Bạn không thể thao tác trên tài khoản có quyền cao hơn quyền của bạn. Quyền bạn đang thiếu: ${missing.map(describe).join(", ")}.`);
  }
}

/** Các nhóm sắp được gán mới phải có quyền ⊆ quyền của mình. */
export async function assertCanAssignRoles(db: Db, actor: Actor, roleIds: readonly number[]): Promise<void> {
  assertCanGrant(actor.perms, await permsOfRoles(db, roleIds));
}
