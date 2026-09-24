import { beforeEach, describe, expect, it } from "vitest";
import { getRole, listRoles } from "@/server/roles/queries";
import { seed } from "../../prisma/seed-lib";
import { prisma, resetDb } from "../helpers/db";
import { makeUser } from "../helpers/factories";

beforeEach(async () => {
  await resetDb();
  await seed(prisma);
});

describe("roles queries", () => {
  it("listRoles: đếm người dùng + số quyền, nhóm hệ thống có cờ isSystem", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "Thủ kho" } });
    await makeUser({ roles: { create: { roleId: role.id } } });
    const rows = await listRoles(prisma);
    const kho = rows.find((r) => r.name === "Thủ kho")!;
    expect(kho).toMatchObject({ userCount: 1, isSystem: true });
    expect(kho.permissionCount).toBeGreaterThan(0);
    expect(rows.find((r) => r.name === "Bán hàng")!.userCount).toBe(0);
  });

  it("getRole: mã quyền + người dùng, không lộ passwordHash; không có → 404", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "Thủ kho" } });
    await makeUser({ username: "kho1", roles: { create: { roleId: role.id } } });
    const got = await getRole(prisma, role.id);
    expect(got.permissionCodes).toContain("stock.view");
    expect(got.users.map((u) => u.username)).toEqual(["kho1"]);
    expect(JSON.stringify(got)).not.toContain("passwordHash");
    await expect(getRole(prisma, 999999)).rejects.toMatchObject({ status: 404 });
  });
});
