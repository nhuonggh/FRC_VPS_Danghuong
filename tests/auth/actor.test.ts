import { beforeEach, describe, expect, it } from "vitest";
import { loadActor } from "@/server/auth/actor";
import { resolveRolePermissions } from "@/lib/permissions/catalog";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

beforeEach(resetDb);

async function userWithRole(roleName: string, over = {}) {
  await seed(prisma);
  const u = await makeUser(over);
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  await prisma.userRole.create({ data: { userId: u.id, roleId: role.id } });
  return u;
}

describe("loadActor", () => {
  it("gộp quyền từ vai trò", async () => {
    const u = await userWithRole("Thủ kho");
    const a = await loadActor(prisma, u.id);
    expect(a!.perms.has("stock.view")).toBe(true);
    expect(a!.perms.has("cost.view")).toBe(false);
  });

  it("gộp quyền của NHIỀU vai trò", async () => {
    const u = await userWithRole("Thủ kho");
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "Thủ quỹ" } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: role.id } });
    const a = await loadActor(prisma, u.id);
    expect(a!.perms.has("stock.view")).toBe(true);
    expect(a!.perms.has("receipt.manage")).toBe(true);
  });

  it("quyền = HỢP đúng của mọi vai trò (không mất, không thừa, không trùng)", async () => {
    const u = await userWithRole("Thủ kho");
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "Thủ quỹ" } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: role.id } });
    const expected = new Set([...resolveRolePermissions("Thủ kho"), ...resolveRolePermissions("Thủ quỹ")]);
    const a = await loadActor(prisma, u.id);
    expect([...a!.perms].sort()).toEqual([...expected].sort());
  });

  it("khoá tài khoản có hiệu lực NGAY: phiên cũ không còn actor", async () => {
    const u = await userWithRole("Kế toán");
    expect(await loadActor(prisma, u.id)).not.toBeNull();
    await prisma.user.update({ where: { id: u.id }, data: { isLocked: true } });
    expect(await loadActor(prisma, u.id)).toBeNull();
  });

  it("mở khoá lại thì có actor trở lại", async () => {
    const u = await userWithRole("Kế toán", { isLocked: true });
    expect(await loadActor(prisma, u.id)).toBeNull();
    await prisma.user.update({ where: { id: u.id }, data: { isLocked: false } });
    expect(await loadActor(prisma, u.id)).not.toBeNull();
  });

  it("admin đổi quyền vai trò → request kế tiếp thấy ngay (không cache trong JWT)", async () => {
    const u = await userWithRole("Thủ kho");
    const perm = await prisma.permission.findUniqueOrThrow({ where: { code: "cost.view" } });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "Thủ kho" } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    expect((await loadActor(prisma, u.id))!.perms.has("cost.view")).toBe(true);
  });

  it("user không tồn tại → null; mustChangePassword được phản ánh", async () => {
    expect(await loadActor(prisma, 99999)).toBeNull();
    const u = await userWithRole("Kế toán", { mustChangePassword: true });
    expect((await loadActor(prisma, u.id))!.mustChangePassword).toBe(true);
  });
});
