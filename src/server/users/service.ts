import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { normalizeEmail, normalizePassword, normalizeUsername } from "@/server/auth/normalize";
import {
  generateTempPassword, hashPassword, validatePasswordStrength, verifyPassword,
} from "@/server/auth/password";
import { DomainError, FieldConflictError } from "@/server/http/errors";
import { withIdempotency } from "@/server/idempotency/with-idempotency";
import { assertCanAffectUser, assertCanAssignRoles } from "./privilege";
import type { CreateUserInput } from "./schemas";

/** MỌI hàm nhận `db` là transaction client và PHẢI chạy trong prisma.$transaction (rollback khi vi phạm bất biến). */
type Db = Prisma.TransactionClient;

async function getUserOrThrow(db: Db, id: number) {
  const u = await db.user.findUnique({ where: { id }, include: { roles: { include: { role: true } } } });
  if (!u) throw new DomainError("Không tìm thấy người dùng.", 404);
  return u;
}

/** Khoá tư vấn (advisory) dùng chung cho mọi thao tác có thể làm giảm số quản trị viên. */
const ADMIN_INVARIANT_LOCK = 7_710_001;

/**
 * Tuần tự hoá các thao tác khoá/đổi vai trò/đổi quyền: khoá tự nhả khi transaction kết thúc.
 * Không có nó, hai quản trị viên cùng khoá nhau (mỗi bên đều thấy bên kia "còn hoạt động" vì chưa commit)
 * sẽ cùng thành công và hệ thống hết quản trị viên. GỌI TRƯỚC khi đọc/ghi trạng thái.
 */
export async function lockAdminInvariant(db: Db): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_INVARIANT_LOCK})`;
}

/**
 * Bất biến: luôn còn ≥ 1 tài khoản đang hoạt động (không bị khoá) có quyền user.manage.
 * Quyền = HỢP của mọi vai trò của user (user có ≥ 1 vai trò mang user.manage là đủ).
 * Gọi SAU khi thay đổi, trong transaction (đã lockAdminInvariant); ném lỗi → rollback, không ghi gì.
 */
export async function assertAdminRemains(db: Db): Promise<void> {
  const n = await db.user.count({
    where: {
      isLocked: false,
      roles: { some: { role: { permissions: { some: { permission: { code: "user.manage" } } } } } },
    },
  });
  if (n < 1) {
    throw new DomainError("Hệ thống phải còn ít nhất một tài khoản đang hoạt động có quyền quản lý người dùng.");
  }
}

const EMAIL_TAKEN = "Email đã được dùng cho tài khoản khác.";
const emailTaken = () => new FieldConflictError(EMAIL_TAKEN, { email: EMAIL_TAKEN });

/** Email lưu DB: chuẩn hoá; rỗng/thiếu → NULL (khớp CHECK users_email_normalized_chk). */
export const toStoredEmail = (raw: string | null | undefined): string | null => {
  const v = raw == null ? "" : normalizeEmail(raw);
  return v === "" ? null : v;
};

/** P2002 trên cột email (hai yêu cầu đồng thời cùng email: cả hai qua bước kiểm tra, bên chậm hơn vấp UNIQUE). */
const isEmailUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && JSON.stringify(e.meta ?? {}).includes("email");

async function loadRoles(db: Db, roleIds: number[]) {
  const ids = [...new Set(roleIds)];
  if (ids.length === 0) throw new DomainError("Chọn ít nhất 1 nhóm quyền.", 400);
  const roles = await db.role.findMany({ where: { id: { in: ids } } });
  if (roles.length !== ids.length) throw new DomainError("Nhóm quyền không hợp lệ.", 400);
  return roles;
}

export async function createUser(db: Db, actor: Actor, input: CreateUserInput) {
  assertCan(actor.perms, "user.manage");
  const username = normalizeUsername(input.username);
  if (await db.user.findUnique({ where: { username } })) throw new DomainError("Tên đăng nhập đã tồn tại.");
  const email = toStoredEmail(input.email);
  if (email && (await db.user.findUnique({ where: { email } }))) throw emailTaken();
  const roles = await loadRoles(db, input.roleIds);
  await assertCanAssignRoles(db, actor, roles.map((r) => r.id)); // không tạo user mạnh hơn mình
  const tempPassword = generateTempPassword();
  let user;
  try {
    user = await db.user.create({
      data: {
        username,
        email,
        fullName: input.fullName.normalize("NFC").trim(),
        passwordHash: await hashPassword(tempPassword),
        mustChangePassword: true,
        roles: { create: roles.map((r) => ({ roleId: r.id })) },
      },
    });
  } catch (e) {
    // Hai yêu cầu đồng thời cùng tên/email: cả hai qua bước kiểm tra ở trên, bên chậm hơn vấp UNIQUE
    if (isEmailUniqueViolation(e)) throw emailTaken();
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new DomainError("Tên đăng nhập đã tồn tại.");
    }
    throw e;
  }
  await writeAudit(db, {
    userId: actor.userId, action: "user.create", entity: "User", entityId: user.id,
    after: { username, fullName: user.fullName, email, roles: roles.map((r) => r.name) }, // KHÔNG mật khẩu/hash
  });
  return { id: user.id, username, tempPassword };
}

/**
 * Tạo user với Idempotency-Key (D-10). Mật khẩu tạm chỉ đi qua bộ nhớ của lời gọi ĐẦU TIÊN;
 * bảng idempotency_keys chỉ lưu `{ id }`. Gọi lặp lại cùng khoá → cùng id, `tempPassword: null`
 * (UI hướng dẫn dùng "Cấp lại mật khẩu"). Kiểm tra quyền chạy TRƯỚC để lặp lại không lách được quyền.
 */
export async function createUserIdempotent(
  prisma: PrismaClient,
  actor: Actor,
  key: string,
  input: CreateUserInput,
): Promise<{ id: number; tempPassword: string | null }> {
  assertCan(actor.perms, "user.manage");
  let tempPassword: string | null = null;
  const { id } = await withIdempotency(prisma, { userId: actor.userId, scope: "user.create", key }, async (tx) => {
    const r = await createUser(tx, actor, input);
    tempPassword = r.tempPassword; // chỉ giữ trong bộ nhớ request — KHÔNG trả về từ work (sẽ bị lưu)
    return { id: r.id };
  });
  return { id, tempPassword };
}

export async function updateProfile(db: Db, actor: Actor, userId: number, input: { fullName: string }) {
  assertCan(actor.perms, "user.manage");
  const u = await getUserOrThrow(db, userId);
  await assertCanAffectUser(db, actor, userId);
  const fullName = input.fullName.normalize("NFC").trim();
  if (fullName === u.fullName) return;
  await db.user.update({ where: { id: userId }, data: { fullName } });
  await writeAudit(db, {
    userId: actor.userId, action: "user.update_profile", entity: "User", entityId: userId,
    before: { fullName: u.fullName }, after: { fullName },
  });
}

/**
 * Đặt/gỡ email đăng nhập Google. Email = CHÌA KHOÁ vào tài khoản qua Google → đổi email tương đương cấp lại mật khẩu:
 * cùng rào như resetPassword (user.manage + không tác động tài khoản mạnh hơn mình + khoá tư vấn chống TOCTOU),
 * và ghi audit giá trị cũ/mới. Không đổi → không ghi gì.
 */
export async function setUserEmail(db: Db, actor: Actor, userId: number, rawEmail: string | null) {
  assertCan(actor.perms, "user.manage");
  await lockAdminInvariant(db);
  const u = await getUserOrThrow(db, userId);
  await assertCanAffectUser(db, actor, userId); // chặn gắn email của mình vào tài khoản Giám đốc để chiếm quyền
  const email = toStoredEmail(rawEmail);
  if (email === u.email) return;
  if (email) {
    const other = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (other && other.id !== userId) throw emailTaken();
  }
  try {
    await db.user.update({ where: { id: userId }, data: { email } });
  } catch (e) {
    if (isEmailUniqueViolation(e)) throw emailTaken();
    throw e;
  }
  await writeAudit(db, {
    userId: actor.userId, action: "user.set_email", entity: "User", entityId: userId,
    before: { email: u.email }, after: { email },
  });
}

export async function setUserRoles(db: Db, actor: Actor, userId: number, roleIds: number[]) {
  assertCan(actor.perms, "user.manage");
  await lockAdminInvariant(db);
  const u = await getUserOrThrow(db, userId);
  const roles = await loadRoles(db, roleIds);
  await assertCanAffectUser(db, actor, userId); // đối tượng (và các nhóm sắp gỡ) không được vượt quyền mình
  await assertCanAssignRoles(db, actor, roles.map((r) => r.id)); // nhóm mới không được vượt quyền mình
  await db.userRole.deleteMany({ where: { userId } });
  await db.userRole.createMany({ data: roles.map((r) => ({ userId, roleId: r.id })) });
  await assertAdminRemains(db);
  await writeAudit(db, {
    userId: actor.userId, action: "user.set_roles", entity: "User", entityId: userId,
    before: { roles: u.roles.map((r) => r.role.name) }, after: { roles: roles.map((r) => r.name) },
  });
}

export async function setLocked(db: Db, actor: Actor, userId: number, locked: boolean) {
  assertCan(actor.perms, "user.manage");
  if (locked && userId === actor.userId) throw new DomainError("Bạn không thể tự khóa tài khoản của mình.");
  await lockAdminInvariant(db); // cả mở khoá: đọc quyền đối tượng (assertCanAffectUser) không được đua với việc nâng quyền đồng thời
  const u = await getUserOrThrow(db, userId);
  await assertCanAffectUser(db, actor, userId);
  if (u.isLocked === locked) return;
  await db.user.update({ where: { id: userId }, data: { isLocked: locked } });
  if (locked) await assertAdminRemains(db);
  await writeAudit(db, {
    userId: actor.userId, action: locked ? "user.lock" : "user.unlock", entity: "User", entityId: userId,
    before: { isLocked: u.isLocked }, after: { isLocked: locked },
  });
}

export async function resetPassword(db: Db, actor: Actor, userId: number) {
  assertCan(actor.perms, "user.manage");
  await lockAdminInvariant(db); // tuần tự hoá với setUserRoles/updateRolePermissions (chống TOCTOU khi đọc quyền đối tượng)
  await getUserOrThrow(db, userId);
  await assertCanAffectUser(db, actor, userId); // không chiếm tài khoản mạnh hơn mình
  const tempPassword = generateTempPassword();
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true } });
  await writeAudit(db, { userId: actor.userId, action: "user.reset_password", entity: "User", entityId: userId });
  return { tempPassword };
}

/** Tự đổi mật khẩu — không cần quyền đặc biệt. */
export async function changeOwnPassword(db: Db, actor: Actor, input: { current: string; next: string }) {
  const u = await getUserOrThrow(db, actor.userId);
  if (!(await verifyPassword(input.current, u.passwordHash))) throw new DomainError("Mật khẩu hiện tại không đúng.");
  if (normalizePassword(input.next) === normalizePassword(input.current)) throw new DomainError("Mật khẩu mới phải khác mật khẩu hiện tại.", 400);
  const weak = validatePasswordStrength(input.next, u.username);
  if (weak) throw new DomainError(weak, 400);
  await db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(input.next), mustChangePassword: false } });
  await writeAudit(db, { userId: actor.userId, action: "user.change_password", entity: "User", entityId: u.id });
}
