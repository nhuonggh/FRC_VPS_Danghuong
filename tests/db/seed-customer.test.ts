import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../prisma/seed-lib";
import { DEFAULT_SEED_FILE, seedCustomerData, type CustomerSeed } from "../../prisma/seed-customer";
import { prisma, resetDb } from "../helpers/db";

const bundle = () => JSON.parse(readFileSync(DEFAULT_SEED_FILE, "utf8")) as CustomerSeed;
beforeEach(async () => { await resetDb(); await seed(prisma, { bootstrapAdminPassword: "Mat-khau-khoi-tao-1!" }); });

describe("nạp dữ liệu khách khi deploy", () => {
  it("nạp đủ danh mục, công ty, người dùng, khách/NCC, sản phẩm", async () => {
    const d = bundle(); const logs: string[] = [];
    expect(await seedCustomerData(prisma, { log: (m) => logs.push(m) })).toBe(true);
    expect(await prisma.product.count()).toBe(d.products.length);
    expect(await prisma.partner.count({ where: { isCustomer: true } })).toBe(d.partners.filter((p) => p.kind === "customer").length);
    expect(await prisma.partner.count({ where: { isSupplier: true } })).toBe(d.partners.filter((p) => p.kind === "supplier").length);
    expect(await prisma.processingType.count()).toBe(d.processingTypes.length);
    expect(await prisma.vehicle.count()).toBe(d.vehicles.length);
    expect(await prisma.cashAccount.count()).toBe(d.cashAccounts.length);
    expect(await prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ name: d.company.name, taxCode: d.company.taxCode });
    expect(logs.join("\n")).not.toMatch(/mật khẩu|password/i);
  });

  it("khách gắn đúng người phụ trách; người dùng có email Google, buộc đổi mật khẩu, nhóm quyền đúng", async () => {
    const d = bundle(); await seedCustomerData(prisma);
    const owner = d.partners.find((p) => p.owner)!; const row = await prisma.partner.findUniqueOrThrow({ where: { code: owner.code }, include: { owner: true } });
    expect(row.owner?.username).toBe(owner.owner!.toLowerCase());
    const u = d.users.find((x) => x.email)!; const user = await prisma.user.findUniqueOrThrow({ where: { username: u.username.toLowerCase() }, include: { roles: { include: { role: true } } } });
    expect(user).toMatchObject({ email: u.email, mustChangePassword: true }); expect(user.roles.map((r) => r.role.name)).toEqual([u.role]);
  });

  it("tìm không dấu hoạt động với dữ liệu đã nạp (searchText)", async () => {
    await seedCustomerData(prisma);
    expect(await prisma.product.count({ where: { searchText: { contains: "phu kien 300 ld" } } })).toBeGreaterThan(0);
  });

  it("chạy lại không nạp nữa; DB đã có khách/sản phẩm thì bỏ qua, không ghi đè công ty đã chỉnh", async () => {
    expect(await seedCustomerData(prisma)).toBe(true);
    await prisma.partner.deleteMany({ where: { code: bundle().partners[0]!.code } });
    expect(await seedCustomerData(prisma)).toBe(false);
    expect(await prisma.partner.count()).toBe(bundle().partners.length - 1);
    await resetDb(); await seed(prisma, {}); await prisma.companySetting.update({ where: { id: 1 }, data: { name: "Tên đã sửa tay" } });
    await seedCustomerData(prisma); expect((await prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } })).name).toBe("Tên đã sửa tay");
  });

  it("không có file ⇒ bỏ qua", async () => { expect(await seedCustomerData(prisma, { file: path.join(process.cwd(), "khong-co.json") })).toBe(false); });

  it("seed-customer.ts chỉ import file có trong image migrator (Dockerfile)", () => {
    const src = readFileSync("prisma/seed-customer.ts", "utf8"); const docker = readFileSync("Dockerfile", "utf8");
    const rel = [...src.matchAll(/from "(\.\.\/[^"]+)"/g)].map((m) => m[1]!.replace("../", "") + ".ts");
    expect(rel.length).toBeGreaterThan(0);
    for (const f of rel) expect(docker, `Dockerfile thiếu COPY ${f}`).toContain(f.split("/").pop()!);
  });
});
