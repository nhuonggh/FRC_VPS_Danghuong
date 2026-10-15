import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
// KHÔNG import zod/exceljs/service: image migrator chỉ có prisma + @prisma/client + tsx + bcryptjs (Dockerfile stage migrator)
import { normalizeSearch } from "../src/lib/search";
import { hashPassword, tempPasswordExpiry } from "../src/server/auth/password";

/** Dữ liệu khách đóng gói bởi scripts/build-customer-seed-json.ts (mỗi dòng đã qua parseRow của bộ nhập Excel). */
export interface CustomerSeed {
  version: 1 | 2;
  groups: { name: string }[]; warehouses: { name: string }[]; vehicles: { plate: string }[]; drivers: { name: string; isAssistant: boolean }[];
  /** v2: nhóm hàng của sản phẩm. */
  productGroups?: { name: string }[];
  routes: { name: string }[]; expenseTypes: { name: string }[]; cashAccounts: { name: string; type: "CASH" | "BANK"; bankNo: string | null }[];
  processingTypes: { name: string; note: string | null }[];
  company: { name: string; address: string; phone: string; taxCode: string; bank: { bankName: string; accountNo: string; accountHolder: string; branch: string } };
  /** Mẫu in mặc định (người ký + chân phiếu), tắt sẵn đến khi cấu hình webhook. Thêm nếu CHƯA có (docType + tên), không bao giờ ghi đè. */
  printTemplates?: { docType: string; name: string; title: string; signerName: string; footerNote: string }[];
  users: { fullName: string; username: string; email: string; role: string }[];
  partners: { code: string; name: string; kind: "customer" | "supplier"; /** v2: vừa khách vừa NCC; thiếu ⇒ suy từ kind. */ isCustomer?: boolean; isSupplier?: boolean; group: string; phone: string; address: string; note: string; debtLimit: string; allowCredit: boolean; owner: string | null }[];
  products: { code: string; name: string; kind: "HANG" | "NVL" | "THANH_PHAM" | "PHU_KIEN"; baseUnit: string; minStock: string; unit: string; factor: string | null; isCoil: boolean; isActive: boolean; note: string; /** v2 */ group?: string | null }[];
}

export const DEFAULT_SEED_FILE = path.join(process.cwd(), "prisma", "data", "customer-seed.json");
const DEFAULT_COMPANY_NAME = "Xưởng tôn Đặng Hương";

/**
 * Nạp dữ liệu khách khi deploy. CHỈ chạy khi chưa có khách/NCC và sản phẩm nào (giai đoạn xây dựng): một khi đã có dữ liệu
 * thì không bao giờ nạp lại, nên xoá/sửa tay sau đó không bị deploy sau ghi đè. Trả về `false` nếu bỏ qua.
 * Người dùng được tạo với mật khẩu ngẫu nhiên không ai biết + email Google (đăng nhập Google, hoặc quản trị "Cấp lại mật khẩu"):
 * không in mật khẩu ra log CI.
 */
export async function seedCustomerData(prisma: PrismaClient, opts: { file?: string; log?: (msg: string) => void } = {}): Promise<boolean> {
  const log = opts.log ?? (() => undefined); const file = opts.file ?? DEFAULT_SEED_FILE;
  if (!existsSync(file)) { log("Dữ liệu khách: không có file — bỏ qua"); return false; }
  const seed = JSON.parse(readFileSync(file, "utf8")) as CustomerSeed;
  if (seed.version !== 1 && seed.version !== 2) throw new Error(`customer-seed.json: phiên bản ${String(seed.version)} không hỗ trợ`);
  // Chạy MỖI lần deploy (idempotent) để DB đã có dữ liệu vẫn nhận mẫu in mặc định mới.
  const templates = seed.printTemplates?.length ? (await prisma.printTemplate.createMany({ data: seed.printTemplates.map((t) => ({ docType: t.docType, name: t.name, title: t.title, signerName: t.signerName, footerNote: t.footerNote })), skipDuplicates: true })).count : 0;
  if (templates) log(`Dữ liệu khách: thêm ${templates} mẫu in mặc định`);
  if ((await prisma.partner.count()) + (await prisma.product.count()) > 0) {
    if (!(seed.version === 2 && (await replaceDemoData(prisma, log)))) { log("Dữ liệu khách: DB đã có khách/sản phẩm — bỏ qua"); return false; }
  }

  const roles = new Map((await prisma.role.findMany({ select: { id: true, name: true } })).map((r) => [normalizeSearch(r.name), r.id]));
  const userPasswords = await Promise.all(seed.users.map(() => hashPassword(randomBytes(24).toString("base64url"))));
  await prisma.$transaction(async (tx) => {
    await tx.partnerGroup.createMany({ data: seed.groups, skipDuplicates: true });
    await tx.warehouse.createMany({ data: seed.warehouses, skipDuplicates: true });
    await tx.vehicle.createMany({ data: seed.vehicles, skipDuplicates: true });
    if ((await tx.driver.count()) === 0) await tx.driver.createMany({ data: seed.drivers });
    await tx.route.createMany({ data: seed.routes, skipDuplicates: true });
    await tx.expenseType.createMany({ data: seed.expenseTypes, skipDuplicates: true });
    await tx.cashAccount.createMany({ data: seed.cashAccounts, skipDuplicates: true });
    if (seed.productGroups?.length) await tx.productGroup.createMany({ data: seed.productGroups, skipDuplicates: true });
    await tx.processingType.createMany({ data: seed.processingTypes, skipDuplicates: true });

    const company = await tx.companySetting.findUnique({ where: { id: 1 } });
    if (!company || company.name === DEFAULT_COMPANY_NAME) {
      const c = seed.company; const data = { name: c.name, address: c.address || null, phone: c.phone || null, taxCode: c.taxCode || null, bankInfo: c.bank as Prisma.InputJsonValue };
      await tx.companySetting.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
    }

    let usersCreated = 0;
    for (const [i, u] of seed.users.entries()) {
      const roleId = roles.get(normalizeSearch(u.role));
      if (!roleId) { log(`Dữ liệu khách: bỏ qua người dùng ${u.username} — không có nhóm quyền "${u.role}"`); continue; }
      if (await tx.user.findUnique({ where: { username: u.username.toLowerCase() } })) continue;
      if (u.email && (await tx.user.findUnique({ where: { email: u.email } }))) continue;
      await tx.user.create({ data: { username: u.username.toLowerCase(), fullName: u.fullName.normalize("NFC").trim(), email: u.email || null, emailChangedAt: u.email ? new Date() : null, passwordHash: userPasswords[i]!, mustChangePassword: true, tempPasswordExpiresAt: tempPasswordExpiry(), roles: { create: { roleId } } } });
      usersCreated++;
    }

    const groups = new Map((await tx.partnerGroup.findMany()).map((g) => [g.name, g.id]));
    const owners = new Map((await tx.user.findMany({ select: { id: true, username: true } })).map((u) => [u.username.toLowerCase(), u.id]));
    await tx.partner.createMany({ data: seed.partners.map((p) => ({ code: p.code, name: p.name, searchText: normalizeSearch(`${p.code} ${p.name} ${p.phone}`), groupId: groups.get(p.group)!, isCustomer: p.isCustomer ?? p.kind === "customer", isSupplier: p.isSupplier ?? p.kind === "supplier", ownerUserId: p.owner ? (owners.get(p.owner.toLowerCase()) ?? null) : null, debtLimit: new Prisma.Decimal(p.debtLimit), allowCredit: p.allowCredit, phone: p.phone || null, address: p.address || null, note: p.note || null })) });
    const pgroups = new Map((await tx.productGroup.findMany()).map((g) => [g.name, g.id]));
    await tx.product.createMany({ data: seed.products.map((p) => ({ groupId: p.group ? (pgroups.get(p.group) ?? null) : null, code: p.code, name: p.name, searchText: normalizeSearch(`${p.code} ${p.name}`), kind: p.kind, baseUnit: p.baseUnit, minStock: new Prisma.Decimal(p.minStock), isCoil: p.isCoil, isActive: p.isActive, note: p.note || null })) });
    for (const p of seed.products.filter((x) => x.unit && x.factor)) await tx.productUnit.create({ data: { product: { connect: { code: p.code } }, unit: p.unit, factor: new Prisma.Decimal(p.factor!) } });
    log(`Dữ liệu khách: nạp ${seed.partners.length} khách/NCC, ${seed.products.length} sản phẩm, ${usersCreated} người dùng, ${seed.processingTypes.length} kiểu gia công`);
  }, { timeout: 120_000 });
  return true;
}

/**
 * Dữ liệu demo của bản v1 (khách KH001 hoặc SP SP00001 do chính seed này tạo) được THAY bằng bản v2 — chỉ khi chưa có bất kỳ chứng từ/số đầu kỳ nào.
 * Có chứng từ ⇒ không đụng gì (trả false). Chạy một lần: sau khi thay, mã demo không còn nên lần deploy sau không thay nữa.
 */
async function replaceDemoData(prisma: PrismaClient, log: (msg: string) => void): Promise<boolean> {
  const demo = (await prisma.partner.count({ where: { code: "KH001" } })) + (await prisma.product.count({ where: { code: "SP00001" } }));
  if (!demo) return false;
  const used = (await Promise.all([prisma.saleOrder.count(), prisma.quote.count(), prisma.purchase.count(), prisma.stockAdjustment.count(), prisma.receipt.count(), prisma.payment.count(), prisma.goodsReturn.count(), prisma.stockLedger.count(), prisma.openingStock.count(), prisma.openingDebt.count(), prisma.openingDiscount.count(), prisma.partnerLedger.count(), prisma.productionOrder.count(), prisma.stocktake.count(), prisma.bom.count(), prisma.debtAdjustment.count(), prisma.debtTransfer.count()])).reduce((a, b) => a + b, 0);
  if (used > 0) { log(`Dữ liệu khách: có ${used} bản ghi chứng từ/số đầu kỳ — KHÔNG thay dữ liệu demo`); return false; }
  await prisma.$transaction([prisma.product.deleteMany(), prisma.partner.deleteMany()]);
  log("Dữ liệu khách: đã xoá khách/sản phẩm demo v1 để nạp bản v2");
  return true;
}
