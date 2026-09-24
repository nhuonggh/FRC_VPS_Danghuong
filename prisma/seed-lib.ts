import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { PERMISSIONS, ROLE_DEFAULTS, resolveRolePermissions } from "../src/lib/permissions/catalog";

export interface SeedOptions {
  bootstrapAdminPassword?: string;
}

const ADMIN_ROLE = "Giám đốc";

export async function seed(prisma: PrismaClient, opts: SeedOptions = {}): Promise<void> {
  // 1. Danh mục quyền: luôn đồng bộ theo code (thêm quyền mới ở bản sau tự vào DB)
  for (const p of PERMISSIONS) {
    const isSensitive = "sensitive" in p ? Boolean(p.sensitive) : false;
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { label: p.label, groupName: p.group, isSensitive },
      create: { code: p.code, label: p.label, groupName: p.group, isSensitive },
    });
  }
  const permByCode = new Map((await prisma.permission.findMany()).map((p) => [p.code, p.id]));

  // 2. Vai trò mẫu: chỉ gán quyền mặc định khi vai trò MỚI tạo (không ghi đè phần khách đã chỉnh)
  for (const name of Object.keys(ROLE_DEFAULTS)) {
    const existing = await prisma.role.findUnique({ where: { name } });
    if (existing) continue;
    // Nguyên tử: vai trò + quyền mặc định cùng commit/rollback. Nếu tách rời, sập giữa chừng sẽ để lại
    // vai trò rỗng và lần seed sau (`if (existing) continue`) không bao giờ bù quyền → khoá hệ thống.
    const ids = [...resolveRolePermissions(name)].map((c) => permByCode.get(c)!);
    await prisma.$transaction(async (tx) => {
      const role = await tx.role.create({ data: { name, isSystem: true } });
      await tx.rolePermission.createMany({
        data: ids.map((permissionId) => ({ roleId: role.id, permissionId })),
      });
    });
  }

  // 3. Công ty (bảng 1 dòng)
  await prisma.companySetting.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, name: "Xưởng tôn Đặng Hương" },
  });

  // 4. Kỳ đầu tiên (luôn có đúng 1 kỳ OPEN)
  if ((await prisma.period.count()) === 0) {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    await prisma.period.create({
      data: { name: `Kỳ khởi tạo ${dd}/${mm}/${now.getFullYear()}`, status: "OPEN", isOpen: true },
    });
  }

  // 5. Admin khởi tạo (chỉ khi bảng users trống và có mật khẩu). KHÔNG log mật khẩu.
  if (opts.bootstrapAdminPassword) {
    const passwordHash = await bcrypt.hash(opts.bootstrapAdminPassword, 10);
    await prisma.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) return;
      const role = await tx.role.findUniqueOrThrow({ where: { name: ADMIN_ROLE } });
      await tx.user.create({
        data: {
          username: "admin",
          fullName: "Quản trị hệ thống",
          passwordHash,
          mustChangePassword: true,
          roles: { create: { roleId: role.id } },
        },
      });
    });
  }
}
