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
    expect(await prisma.partner.count({ where: { isCustomer: true } })).toBe(d.partners.filter((p) => p.isCustomer ?? p.kind === "customer").length);
    expect(await prisma.partner.count({ where: { isSupplier: true } })).toBe(d.partners.filter((p) => p.isSupplier ?? p.kind === "supplier").length);
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
    expect(await prisma.product.count({ where: { searchText: { contains: "ton sssc viet nhat" } } })).toBeGreaterThan(0);
  });

  it("chạy lại không nạp nữa; DB đã có khách/sản phẩm thì bỏ qua, không ghi đè công ty đã chỉnh", async () => {
    expect(await seedCustomerData(prisma)).toBe(true);
    await prisma.partner.deleteMany({ where: { code: bundle().partners[0]!.code } });
    expect(await seedCustomerData(prisma)).toBe(false);
    expect(await prisma.partner.count()).toBe(bundle().partners.length - 1);
    await resetDb(); await seed(prisma, {}); await prisma.companySetting.update({ where: { id: 1 }, data: { name: "Tên đã sửa tay" } });
    await seedCustomerData(prisma); expect((await prisma.companySetting.findUniqueOrThrow({ where: { id: 1 } })).name).toBe("Tên đã sửa tay");
  });

  it("v2: nhóm hàng gán cho sản phẩm; khách vừa NCC giữ đủ 2 cờ", async () => {
    const d = bundle(); await seedCustomerData(prisma);
    expect(await prisma.productGroup.count()).toBe(d.productGroups!.length);
    const withGroup = d.products.find((x) => x.group)!; expect((await prisma.product.findUniqueOrThrow({ where: { code: withGroup.code }, include: { group: true } })).group?.name).toBe(withGroup.group);
    const both = d.partners.find((x) => x.isCustomer && x.isSupplier)!; expect(await prisma.partner.findUniqueOrThrow({ where: { code: both.code } })).toMatchObject({ isCustomer: true, isSupplier: true });
  });

  it("v2 thay dữ liệu demo v1 (KH001/SP00001) khi chưa có chứng từ; có chứng từ thì giữ nguyên", async () => {
    const d = bundle(); const group = await prisma.partnerGroup.create({ data: { name: "Demo" } });
    await prisma.partner.create({ data: { code: "KH001", name: "Khách demo", groupId: group.id } }); await prisma.product.create({ data: { code: "SP00001", name: "SP demo", baseUnit: "m" } });
    expect(await seedCustomerData(prisma)).toBe(true);
    expect(await prisma.partner.count({ where: { code: "KH001" } })).toBe(0); expect(await prisma.partner.count()).toBe(d.partners.length); expect(await prisma.product.count()).toBe(d.products.length);
    expect(await seedCustomerData(prisma)).toBe(false); // lần sau không còn mã demo ⇒ không thay nữa
  });

  it("v2 KHÔNG xoá demo khi đã có chứng từ", async () => {
    const group = await prisma.partnerGroup.create({ data: { name: "Demo" } });
    await prisma.partner.create({ data: { code: "KH001", name: "Khách demo", groupId: group.id } });
    const period = await prisma.period.findFirstOrThrow(); const u = await prisma.user.findFirstOrThrow();
    await prisma.payment.create({ data: { periodId: period.id, code: "PC-T1", kind: "KHAC", partnerId: null, amount: 1, cashAccountId: (await prisma.cashAccount.create({ data: { name: "Quỹ T", type: "CASH" } })).id, at: new Date(), createdBy: u.id } });
    expect(await seedCustomerData(prisma)).toBe(false); expect(await prisma.partner.count({ where: { code: "KH001" } })).toBe(1);
  });

  it("không có file ⇒ bỏ qua", async () => { expect(await seedCustomerData(prisma, { file: path.join(process.cwd(), "khong-co.json") })).toBe(false); });

  it("seed-customer.ts chỉ import file có trong image migrator (Dockerfile)", () => {
    const src = readFileSync("prisma/seed-customer.ts", "utf8"); const docker = readFileSync("Dockerfile", "utf8");
    const rel = [...src.matchAll(/from "(\.\.\/[^"]+)"/g)].map((m) => m[1]!.replace("../", "") + ".ts");
    expect(rel.length).toBeGreaterThan(0);
    for (const f of rel) expect(docker, `Dockerfile thiếu COPY ${f}`).toContain(f.split("/").pop()!);
  });
});

describe("mẫu in mặc định", () => {
  it("thêm mẫu hóa đơn/phiếu giao (tắt sẵn), chạy lại không nhân đôi, kể cả khi DB đã có dữ liệu; không ghi đè bản đã sửa", async () => {
    const d = bundle(); expect(d.printTemplates?.length).toBeGreaterThan(0);
    await seedCustomerData(prisma); expect(await prisma.printTemplate.count()).toBe(d.printTemplates!.length);
    await prisma.printTemplate.updateMany({ where: { docType: "SALE_INVOICE" }, data: { footerNote: "đã sửa tay" } });
    await prisma.printTemplate.deleteMany({ where: { docType: "DELIVERY_NOTE" } });
    expect(await seedCustomerData(prisma)).toBe(false); // DB đã có khách/sản phẩm
    expect(await prisma.printTemplate.count()).toBe(d.printTemplates!.length);
    expect(await prisma.printTemplate.findFirstOrThrow({ where: { docType: "SALE_INVOICE" } })).toMatchObject({ footerNote: "đã sửa tay", isActive: false });
  });
});
