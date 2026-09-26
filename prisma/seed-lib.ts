import type { PrismaClient } from "@prisma/client";
import { PERMISSIONS, ROLE_DEFAULTS, resolveRolePermissions, type PermissionDef } from "../src/lib/permissions/catalog";
import { toIct } from "../src/lib/time";
// KHÔNG import zod/schemas: image migrator chỉ có prisma + @prisma/client + tsx + bcryptjs (Dockerfile stage migrator)
import { isPrintableAscii, looksLikeEmail, normalizeEmail } from "../src/server/auth/normalize";
import { hashPassword, tempPasswordExpiry } from "../src/server/auth/password";

export interface SeedOptions {
  bootstrapAdminPassword?: string;
  /**
   * Email đăng nhập Google cho `admin` (BOOTSTRAP_ADMIN_EMAIL, tuỳ chọn). CHỈ dùng khi seed TẠO admin (bảng users trống).
   * Không bao giờ gán/khôi phục email cho admin đã tồn tại (quản trị viên có thể đã chủ động gỡ).
   */
  bootstrapAdminEmail?: string;
  /** Danh mục quyền để đồng bộ (mặc định PERMISSIONS). Chỉ tiêm để test mô phỏng "bản sau thêm quyền mới". */
  catalog?: readonly PermissionDef[];
}

const ADMIN_ROLE = "Giám đốc";
/** Vai trò mẫu có mặc định wildcard "*" (giữ MỌI quyền của danh mục). */
const WILDCARD_ROLES = Object.entries(ROLE_DEFAULTS).filter(([, spec]) => spec === "*").map(([name]) => name);

/** Tên kỳ đầu tiên theo NGÀY ICT (không theo múi giờ máy chủ — container thường chạy UTC). */
export function initialPeriodName(now: Date): string {
  const t = toIct(now);
  return `Kỳ khởi tạo ${String(t.d).padStart(2, "0")}/${String(t.m + 1).padStart(2, "0")}/${t.y}`;
}

export async function seed(prisma: PrismaClient, opts: SeedOptions = {}): Promise<void> {
  const catalog = opts.catalog ?? PERMISSIONS;
  // Kiểm email TRƯỚC mọi thao tác ghi: sai định dạng → dừng seed (deploy dừng trước khi thay container, bản cũ vẫn chạy)
  const adminEmail = parseBootstrapEmail(opts.bootstrapAdminEmail);

  // 1+2. Quyền + vai trò mẫu trong MỘT transaction (nguyên tử: sập giữa chừng thì không còn quyền/vai trò nửa vời).
  await prisma.$transaction(
    async (tx) => {
      // 1. Danh mục quyền: luôn đồng bộ theo code. Quyền MỚI tạo trong lần chạy này (bản sau thêm vào catalog) được
      //    cấp cho vai trò wildcard (Giám đốc) ĐÃ tồn tại — nếu không, actor.perms của Giám đốc (đọc từ DB) thiếu quyền đó
      //    và assertCanGrant khiến không ai cấp được nó nữa. Quyền/cấp quyền ĐÃ có không bao giờ bị đụng tới
      //    (khách có thể đã chủ động gỡ quyền khỏi Giám đốc).
      const known = new Set((await tx.permission.findMany({ select: { code: true } })).map((p) => p.code));
      const created: string[] = [];
      for (const p of catalog) {
        const isSensitive = "sensitive" in p ? Boolean(p.sensitive) : false;
        await tx.permission.upsert({
          where: { code: p.code },
          update: { label: p.label, groupName: p.group, isSensitive },
          create: { code: p.code, label: p.label, groupName: p.group, isSensitive },
        });
        if (!known.has(p.code)) created.push(p.code);
      }
      const permByCode = new Map((await tx.permission.findMany()).map((p) => [p.code, p.id]));

      const wildcardRoleIds: number[] = [];
      for (const name of WILDCARD_ROLES) {
        const role = await tx.role.findUnique({ where: { name } });
        if (role) wildcardRoleIds.push(role.id);
      }
      if (created.length > 0 && wildcardRoleIds.length > 0) {
        await tx.rolePermission.createMany({
          data: wildcardRoleIds.flatMap((roleId) => created.map((c) => ({ roleId, permissionId: permByCode.get(c)! }))),
          skipDuplicates: true,
        });
      }

      // 2. Vai trò mẫu: chỉ gán quyền mặc định khi vai trò MỚI tạo (không ghi đè phần khách đã chỉnh)
      for (const name of Object.keys(ROLE_DEFAULTS)) {
        if (await tx.role.findUnique({ where: { name } })) continue;
        const codes = WILDCARD_ROLES.includes(name)
          ? catalog.map((p) => p.code)
          : [...resolveRolePermissions(name)].filter((c) => permByCode.has(c));
        const role = await tx.role.create({ data: { name, isSystem: true } });
        await tx.rolePermission.createMany({
          data: codes.map((c) => ({ roleId: role.id, permissionId: permByCode.get(c)! })),
        });
      }
    },
    { timeout: 60_000 },
  );

  // 3. Công ty (bảng 1 dòng)
  await prisma.companySetting.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: "Xưởng tôn Đặng Hương" },
  });

  // 4. Kỳ đầu tiên (luôn có đúng 1 kỳ OPEN)
  if ((await prisma.period.count()) === 0) {
    await prisma.period.create({ data: { name: initialPeriodName(new Date()), status: "OPEN", isOpen: true } });
  }

  // 5. Admin khởi tạo (chỉ khi bảng users trống và có mật khẩu). KHÔNG log mật khẩu.
  if (opts.bootstrapAdminPassword) {
    const passwordHash = await hashPassword(opts.bootstrapAdminPassword); // cùng BCRYPT_COST + chuẩn hoá NFC như đường đăng nhập
    await prisma.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) return;
      const role = await tx.role.findUniqueOrThrow({ where: { name: ADMIN_ROLE } });
      await tx.user.create({
        data: {
          username: "admin",
          fullName: "Quản trị hệ thống",
          email: adminEmail,
          emailChangedAt: adminEmail ? new Date() : null,
          passwordHash,
          mustChangePassword: true,
          tempPasswordExpiresAt: tempPasswordExpiry(), // mật khẩu khởi tạo cũng là mật khẩu tạm: hết hạn nếu không đổi
          roles: { create: { roleId: role.id } },
        },
      });
    });
  }
}

/** BOOTSTRAP_ADMIN_EMAIL → email đã chuẩn hoá (cùng quy tắc form người dùng), rỗng → null, sai định dạng → ném lỗi. */
export function parseBootstrapEmail(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  // ASCII-only như zod emailSchema (chặn ký tự Unicode bị gập chữ thường thành ASCII, vd dấu Kelvin)
  if (!isPrintableAscii(raw)) throw new Error("BOOTSTRAP_ADMIN_EMAIL không phải email hợp lệ.");
  const email = normalizeEmail(raw);
  if (email === "") return null;
  if (!looksLikeEmail(email)) throw new Error("BOOTSTRAP_ADMIN_EMAIL không phải email hợp lệ.");
  return email;
}
