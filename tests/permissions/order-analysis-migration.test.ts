import { readFileSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import { prisma, resetDb } from "../helpers/db";
beforeEach(resetDb);
it("migration grants the new sales-analysis permission to administrators, preserving accounting purchase rights", async () => {
  const adminPermission = await prisma.permission.create({ data: { code: "role.manage", label: "Quản trị quyền", groupName: "Hệ thống" } });
  const purchasePermission = await prisma.permission.create({ data: { code: "purchase_price.view", label: "Xem giá nhập", groupName: "Nhập hàng" } });
  const admin = await prisma.role.create({ data: { name: "Quản trị riêng", permissions: { create: { permissionId: adminPermission.id } } } });
  const director = await prisma.role.create({ data: { name: "Giám đốc" } });
  const accountant = await prisma.role.create({ data: { name: "Kế toán", permissions: { create: { permissionId: purchasePermission.id } } } });
  const sql = readFileSync("prisma/migrations/20261017120000_order_analysis_access/migration.sql", "utf8");
  for (const statement of sql.split(";").filter(s => s.trim())) await prisma.$executeRawUnsafe(statement);
  const allowed = await prisma.rolePermission.findMany({ where: { permission: { code: "order.analysis.view" } }, select: { roleId: true } });
  expect(allowed.map(r => r.roleId).sort()).toEqual([admin.id, director.id].sort());
  expect(await prisma.rolePermission.count({ where: { roleId: accountant.id, permissionId: purchasePermission.id } })).toBe(1);
  // A repeat deploy must not duplicate grants.
  for (const statement of sql.split(";").filter(s => s.trim())) await prisma.$executeRawUnsafe(statement);
  expect(await prisma.rolePermission.count({ where: { permission: { code: "order.analysis.view" } } })).toBe(2);
});
it("sale cost-hint migration grants the summary permission to accountants only, idempotently", async () => {
  const accountant = await prisma.role.create({ data: { name: "Kế toán" } });
  const warehouse = await prisma.role.create({ data: { name: "Thủ kho" } });
  const sql = readFileSync("prisma/migrations/20261020120000_sale_cost_hint/migration.sql", "utf8");
  for (let i = 0; i < 2; i++) for (const statement of sql.split(";").filter(s => s.replace(/--.*$/gm, "").trim())) await prisma.$executeRawUnsafe(statement);
  const granted = await prisma.rolePermission.findMany({ where: { permission: { code: "sale.cost_hint.view" } }, select: { roleId: true } });
  expect(granted.map(r => r.roleId)).toEqual([accountant.id]);
  expect(granted.map(r => r.roleId)).not.toContain(warehouse.id);
});
