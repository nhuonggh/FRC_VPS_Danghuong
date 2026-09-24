import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seed } from "../prisma/seed-lib";
import { PERMISSIONS } from "@/lib/permissions/catalog";
import { prisma, resetDb } from "./helpers/db";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("seed", () => {
  it("tạo quyền, 5 vai trò, công ty, đúng 1 kỳ OPEN", async () => {
    await seed(prisma);
    expect(await prisma.permission.count()).toBe(PERMISSIONS.length);
    expect((await prisma.role.findMany()).map((r) => r.name).sort()).toEqual(
      ["Bán hàng", "Giám đốc", "Kế toán", "Thủ kho", "Thủ quỹ"].sort(),
    );
    expect(await prisma.companySetting.count()).toBe(1);
    const open = await prisma.period.findMany({ where: { isOpen: true } });
    expect(open).toHaveLength(1);
    expect(open[0]!.status).toBe("OPEN");
  });

  it("idempotent: chạy 2 lần không nhân đôi dữ liệu", async () => {
    await seed(prisma);
    const rolePerms = await prisma.rolePermission.count();
    await seed(prisma);
    expect(await prisma.permission.count()).toBe(PERMISSIONS.length);
    expect(await prisma.role.count()).toBe(5);
    expect(await prisma.rolePermission.count()).toBe(rolePerms);
    expect(await prisma.companySetting.count()).toBe(1);
    expect(await prisma.period.count()).toBe(1);
    expect(await prisma.period.count({ where: { isOpen: true } })).toBe(1);
  });

  it("KHÔNG ghi đè quyền khách đã chỉnh sau khi vai trò đã tồn tại", async () => {
    await seed(prisma);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "Thủ kho" } });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } }); // khách bỏ hết quyền
    await seed(prisma);
    expect(await prisma.rolePermission.count({ where: { roleId: role.id } })).toBe(0);
  });

  it("vai trò Thủ kho không có quyền xem giá vốn trong DB", async () => {
    await seed(prisma);
    const rows = await prisma.rolePermission.findMany({
      where: { role: { name: "Thủ kho" }, permission: { code: "cost.view" } },
    });
    expect(rows).toHaveLength(0);
  });

  it("Giám đốc trong DB có đủ mọi quyền", async () => {
    await seed(prisma);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "Giám đốc" } });
    expect(await prisma.rolePermission.count({ where: { roleId: role.id } })).toBe(PERMISSIONS.length);
  });

  it("tạo admin khởi tạo khi có mật khẩu và chưa có user; bắt đổi mật khẩu; không tạo lần 2", async () => {
    await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123" });
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: "admin" },
      include: { roles: { include: { role: true } } },
    });
    expect(admin.mustChangePassword).toBe(true);
    expect(admin.passwordHash).not.toBe("Mat-khau-tam-123");
    expect(await bcrypt.compare("Mat-khau-tam-123", admin.passwordHash)).toBe(true);
    expect(admin.roles.map((r) => r.role.name)).toEqual(["Giám đốc"]);
    await seed(prisma, { bootstrapAdminPassword: "khac" });
    expect(await prisma.user.count()).toBe(1);
  });

  it("không có mật khẩu khởi tạo → không tạo user", async () => {
    await seed(prisma);
    expect(await prisma.user.count()).toBe(0);
  });

  it("mật khẩu rỗng → không tạo user", async () => {
    await seed(prisma, { bootstrapAdminPassword: "" });
    expect(await prisma.user.count()).toBe(0);
  });

  it("đã có user khác → không tạo admin dù có mật khẩu", async () => {
    await prisma.user.create({ data: { username: "nam", passwordHash: "x", fullName: "Nam" } });
    await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123" });
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.user.findUnique({ where: { username: "admin" } })).toBeNull();
  });

  it("không bao giờ in mật khẩu ra log", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123" });
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain("Mat-khau-tam-123");
  });

  it("tạo vai trò nguyên tử: lỗi giữa chừng khi gán quyền → không còn vai trò rỗng, lần seed sau tạo đủ", async () => {
    const crashing = new Proxy(prisma, {
      get(target, prop) {
        if (prop !== "$transaction") return Reflect.get(target, prop);
        return (fn: (tx: unknown) => Promise<unknown>, opts?: object) =>
          target.$transaction(
            (tx) =>
              fn(
                new Proxy(tx, {
                  get(t, p) {
                    if (p === "rolePermission") return { createMany: () => Promise.reject(new Error("sập giữa chừng")) };
                    return Reflect.get(t, p);
                  },
                }),
              ),
            opts,
          );
      },
    }) as typeof prisma;
    await expect(seed(crashing)).rejects.toThrow("sập giữa chừng");
    expect(await prisma.role.count()).toBe(0);
    expect(await prisma.rolePermission.count()).toBe(0);

    await seed(prisma);
    const gd = await prisma.role.findUniqueOrThrow({ where: { name: "Giám đốc" } });
    expect(await prisma.rolePermission.count({ where: { roleId: gd.id } })).toBe(PERMISSIONS.length);
  });

  it("tạo admin nguyên tử: lỗi khi gán vai trò → không còn user mồ côi, lần seed sau tạo được", async () => {
    await seed(prisma);
    const crashing = new Proxy(prisma, {
      get(target, prop) {
        if (prop !== "$transaction") return Reflect.get(target, prop);
        return (fn: (tx: unknown) => Promise<unknown>, opts?: object) =>
          target.$transaction(
            (tx) =>
              fn(
                new Proxy(tx, {
                  get(t, p) {
                    if (p === "user") return { ...t.user, create: () => Promise.reject(new Error("sập tạo admin")) };
                    return Reflect.get(t, p);
                  },
                }),
              ),
            opts,
          );
      },
    }) as typeof prisma;
    await expect(seed(crashing, { bootstrapAdminPassword: "Mat-khau-tam-123" })).rejects.toThrow("sập tạo admin");
    expect(await prisma.user.count()).toBe(0);
    await seed(prisma, { bootstrapAdminPassword: "Mat-khau-tam-123" });
    expect(await prisma.user.count()).toBe(1);
  });
});
