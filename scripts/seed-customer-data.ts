/**
 * Nạp dữ liệu khách gửi (bảng nhập "DHERP – Bảng nhập dữ liệu đầu vào.xlsx" + file xuất phần mềm cũ "DSSanPham.xls") vào DB.
 * Đi qua ĐÚNG các bộ nhập Excel của hệ thống (cùng luật kiểm tra, audit, idempotency) — không ghi SQL tay.
 *
 *   npx tsx scripts/seed-customer-data.ts --intake <xlsx> --legacy <xls>                    # chỉ XEM TRƯỚC, không ghi gì
 *   npx tsx scripts/seed-customer-data.ts --intake … --legacy … --commit --confirm-db <tên DB>   # ghi thật
 *
 * DB lấy từ DATABASE_URL (biến môi trường, hoặc .env). Ghi thật bắt buộc gõ lại đúng tên DB để tránh nhầm máy.
 * KHÔNG nạp số đầu kỳ (tồn/công nợ/quỹ/chiết khấu): bảng chưa có "Ngày chốt" — nhập sau bằng màn Kỳ & số đầu kỳ.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { normalizeSearch } from "../src/lib/search";
import { loadActor } from "../src/server/auth/actor";
import { catalogImportSpec } from "../src/server/catalog/import-spec";
import { lockCompanyRow, updateCompany } from "../src/server/company/service";
import { commitImport, previewImport } from "../src/server/import/framework";
import type { ImportSpec } from "../src/server/import/types";
import { partnerImportSpec } from "../src/server/partners/import-spec";
import { productImportSpec } from "../src/server/products/import-spec";
import { createUser } from "../src/server/users/service";
import { PRODUCT_HEADERS, PROCESSING_HEADERS, buildProcessingRows, buildProductRows, fixPhone, parseLegacyExport, readIntake, toXlsx, type Row } from "./lib/customer-data";

process.env.DATABASE_URL ? undefined : process.loadEnvFile(".env");
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const COMMIT = args.includes("--commit");

const isExample = (r: Row) => String(r[0] ?? "").trim().startsWith("#");
const data = (rows: Row[] | undefined) => (rows ?? []).slice(1).filter((r) => !isExample(r));
const trim = (rows: Row[], n: number) => rows.map((r) => r.slice(0, n));
const log = (...a: unknown[]) => console.log(...a);

async function runImport(prisma: PrismaClient, actor: { userId: number; perms: ReadonlySet<string> }, label: string, spec: ImportSpec<never> | ImportSpec<any, any>, buffer: Buffer) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const pv = await previewImport(prisma, spec, buffer, { overwrite: false });
  const c = pv.counts; log(`• ${label}: ${pv.total} dòng → tạo ${c.create}, đã có ${c["skip-existing"]}, bỏ qua ${c["skip-reason"]}, lỗi ${c.error}`);
  for (const r of pv.rows.filter((x) => x.status === "error").slice(0, 8)) log(`    dòng ${r.line}: ${r.message}`);
  if (!COMMIT) return pv;
  const key = `seed-customer-${spec.entity}-${createHash("sha1").update(buffer).digest("hex").slice(0, 16)}`;
  const res = await commitImport(prisma, { userId: actor.userId, perms: actor.perms }, spec, buffer, { overwrite: false, idempotencyKey: key });
  log(`    ĐÃ GHI: tạo ${res.created}, bỏ qua ${res.skippedExisting + res.skippedReason}, lỗi ${res.failed}`);
  return pv;
}

async function main() {
  const intakePath = arg("intake"); const legacyPath = arg("legacy");
  if (!intakePath || !legacyPath) throw new Error("Thiếu --intake <xlsx> và --legacy <xls>.");
  const url = new URL(process.env.DATABASE_URL ?? ""); const dbName = url.pathname.slice(1);
  log(`DB đích: ${url.hostname}:${url.port || 5432}/${dbName} — chế độ ${COMMIT ? "GHI THẬT" : "XEM TRƯỚC (không ghi)"}`);
  if (COMMIT && arg("confirm-db") !== dbName) throw new Error(`Ghi thật cần --confirm-db ${dbName}.`);

  const prisma = new PrismaClient();
  try {
    const admin = await prisma.user.findUnique({ where: { username: arg("as") ?? "admin" }, select: { id: true } });
    if (!admin) throw new Error("Không có tài khoản quản trị (mặc định `admin`, đổi bằng --as).");
    const actor = (await loadActor(prisma, admin.id))!;
    const sheets = await readIntake(intakePath);
    const legacy = parseLegacyExport(readFileSync(legacyPath, "utf8"));

    // 1. Danh mục nền
    const simple: [string, string, readonly string[], number][] = [["Nhóm khách hàng", "partner-groups", ["Tên nhóm"], 1], ["Kho", "warehouses", ["Tên kho"], 1], ["Xe", "vehicles", ["Biển số"], 1], ["Lái xe & phụ xe", "drivers", ["Họ tên", "Là phụ xe"], 2], ["Tuyến giao hàng", "routes", ["Tên tuyến"], 1], ["Loại thu chi", "expense-types", ["Tên loại"], 1], ["Ngân hàng & quỹ", "cash-accounts", ["Tên tài khoản", "Loại", "Số tài khoản"], 3]];
    for (const [sheet, key, headers, n] of simple) await runImport(prisma, actor, sheet, catalogImportSpec(key), await toXlsx(headers, trim(data(sheets[sheet]), n)));
    const gcIntake = data(sheets["Kiểu gia công"]).filter((r) => String(r[0]).trim() !== "Kiểu gia công").map((r) => [r[0] ?? null, r[1] ?? null, r[2] ?? null, r[3] ?? null] as Row);
    await runImport(prisma, actor, "Kiểu gia công", catalogImportSpec("processing-types"), await toXlsx(PROCESSING_HEADERS, buildProcessingRows(gcIntake, legacy.processing)));

    // 2. Công ty + người dùng (cần tài khoản người phụ trách TRƯỚC khi nhập khách)
    await seedCompany(prisma, actor, sheets["Công ty"] ?? []);
    await seedUsers(prisma, actor, data(sheets["Người dùng"]));

    // 3. Khách hàng, NCC, sản phẩm
    const partnerRows = (sheet: string) => trim(data(sheets[sheet]), 9).map((r) => { const x = [...r]; x[3] = fixPhone(x[3] ?? null) || null; return x; });
    const PARTNER_HEADERS = ["Mã", "Tên", "Nhóm", "Điện thoại", "Địa chỉ", "Hạn mức nợ", "Cho ghi nợ", "Người phụ trách", "Ghi chú"];
    await runImport(prisma, actor, "Khách hàng", partnerImportSpec("customer"), await toXlsx(PARTNER_HEADERS, partnerRows("Khách hàng")));
    await runImport(prisma, actor, "Nhà cung cấp", partnerImportSpec("supplier"), await toXlsx(PARTNER_HEADERS, partnerRows("Nhà cung cấp")));
    const products = buildProductRows(trim(data(sheets["Sản phẩm"]), 10), legacy);
    log(`  Sản phẩm: ${products.fromIntake} dòng khách điền + ${products.fromLegacy} từ phần mềm cũ; ${products.overlapByName} trùng tên (giữ bản khách điền); ${products.codeChanges.length} mã cũ phải đổi cho hợp lệ; ${products.zeroPrice} mã cũ không có giá.`);
    await runImport(prisma, actor, "Sản phẩm", productImportSpec(), await toXlsx(PRODUCT_HEADERS, products.rows));
    if (arg("code-map")) { writeFileSync(arg("code-map")!, ["Mã cũ\tMã mới", ...products.codeChanges.map((c) => `${c.legacy}\t${c.code}`)].join("\n"), "utf8"); log(`  Bảng đổi mã cũ → mới: ${arg("code-map")}`); }

    // 4. Số đầu kỳ: chỉ báo cáo
    const opening = ["Tồn kho đầu kỳ", "Tồn NVL đầu kỳ", "Công nợ đầu kỳ", "Số dư quỹ đầu kỳ", "Chiết khấu tích lũy"].map((s) => `${s}: ${data(sheets[s]).length} dòng`);
    log(`• Số đầu kỳ KHÔNG nạp (chưa có Ngày chốt: ${String(sheets["HƯỚNG DẪN"]?.[2]?.[1] ?? "").trim() || "trống"}) — ${opening.join("; ")}`);
  } finally { await prisma.$disconnect(); }
}

async function seedCompany(prisma: PrismaClient, actor: Awaited<ReturnType<typeof loadActor>> & object, rows: Row[]) {
  const kv = new Map(rows.slice(1).map((r) => [String(r[0] ?? "").trim(), r[1]]).filter(([k]) => k) as [string, unknown][]);
  const text = (k: string) => String(kv.get(k) ?? "").trim();
  const name = text("Tên công ty"); if (!name) return log("• Công ty: bảng trống — bỏ qua");
  const phone = fixPhone(text("Điện thoại") || null);
  const info = { name, address: text("Địa chỉ"), phone, taxCode: text("Mã số thuế"), logo: "" };
  const bank = { bankName: text("Ngân hàng"), accountNo: text("Số tài khoản"), accountHolder: text("Chủ tài khoản"), branch: text("Chi nhánh") === "không có" ? "" : text("Chi nhánh") };
  const current = await prisma.companySetting.findUnique({ where: { id: 1 } });
  if (current && current.name !== "Xưởng tôn Đặng Hương" && !args.includes("--force-company")) return log(`• Công ty: đã được chỉnh ("${current.name}") — bỏ qua (dùng --force-company để ghi đè)`);
  log(`• Công ty: ${name} · ĐT ${phone} · MST ${info.taxCode} · ${bank.bankName} ${bank.accountNo}`);
  if (!COMMIT) return;
  await prisma.$transaction(async (tx) => {
    const row = await lockCompanyRow(tx); await updateCompany(tx, actor, { section: "info", version: row.updatedAt.getTime(), value: info });
    const after = await tx.companySetting.findUniqueOrThrow({ where: { id: 1 } }); await updateCompany(tx, actor, { section: "bank", version: after.updatedAt.getTime(), value: bank });
  });
}

async function seedUsers(prisma: PrismaClient, actor: Awaited<ReturnType<typeof loadActor>> & object, rows: Row[]) {
  const roles = new Map((await prisma.role.findMany({ select: { id: true, name: true } })).map((r) => [normalizeSearch(r.name), r.id]));
  const out: string[] = [];
  for (const r of rows) {
    const [fullName, username, email, position] = [r[0], r[1], r[2], r[3]].map((v) => String(v ?? "").trim());
    const roleId = roles.get(normalizeSearch(position!));
    if (!username || !fullName) { log(`• Người dùng "${fullName || "?"}": thiếu tên đăng nhập — bỏ qua`); continue; }
    if (!roleId) { log(`• Người dùng ${username}: vị trí "${position}" không khớp nhóm quyền nào — bỏ qua (chờ khách xác nhận vị trí)`); continue; }
    if (await prisma.user.findUnique({ where: { username: username.toLowerCase() } })) { log(`• Người dùng ${username}: đã có — bỏ qua`); continue; }
    log(`• Người dùng ${username} (${fullName}) — ${position}${email ? ` · ${email}` : " · chưa có email Google"}`);
    if (!COMMIT) continue;
    const res = await prisma.$transaction((tx) => createUser(tx, actor, { username, fullName: fullName!, ...(email ? { email } : {}), roleIds: [roleId] }));
    out.push(`${res.username}\t${res.tempPassword}`);
  }
  if (out.length && arg("passwords-out")) { writeFileSync(arg("passwords-out")!, `Tên đăng nhập\tMật khẩu tạm (hết hạn sau 72 giờ, bắt buộc đổi khi đăng nhập lần đầu)\n${out.join("\n")}\n`, "utf8"); log(`  Mật khẩu tạm đã ghi vào ${arg("passwords-out")} — giao cho từng người rồi XOÁ file.`); }
  else if (out.length) log("  (Không có --passwords-out nên mật khẩu tạm KHÔNG được lưu — dùng 'Cấp lại mật khẩu' ở màn Người dùng.)");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
