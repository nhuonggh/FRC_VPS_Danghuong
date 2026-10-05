/**
 * Đóng gói dữ liệu khách (bảng nhập + file phần mềm cũ) thành prisma/data/customer-seed.json.
 * Mỗi dòng đi qua parseRow của đúng các bộ nhập Excel nên luật kiểm tra y hệt nhập tay; lỗi ⇒ dừng, không đóng gói nửa vời.
 * File JSON được prisma/seed-customer.ts nạp khi deploy (image migrator không có exceljs/zod nên không đọc Excel trực tiếp).
 *
 *   npx tsx scripts/build-customer-seed-json.ts --intake <xlsx> --legacy <xls> [--out prisma/data/customer-seed.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { normalizeSearch } from "../src/lib/search";
import { catalogImportSpec } from "../src/server/catalog/import-spec";
import { ownerMap, partnerImportSpec } from "../src/server/partners/import-spec";
import { productImportSpec } from "../src/server/products/import-spec";
import { buildProcessingRows, buildProductRows, fixPhone, parseLegacyExport, readIntake, type Row } from "./lib/customer-data";

const args = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const [intakePath, legacyPath] = [arg("intake"), arg("legacy")]; const outPath = arg("out") ?? "prisma/data/customer-seed.json";
if (!intakePath || !legacyPath) throw new Error("Thiếu --intake và --legacy.");

const isExample = (r: Row) => String(r[0] ?? "").trim().startsWith("#");
const data = (rows: Row[] | undefined) => (rows ?? []).slice(1).filter((r) => !isExample(r));
const cells = (keys: string[], rows: Row[]) => rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? null])));
const fail = (what: string, line: number, errors: string[]) => { throw new Error(`${what} dòng ${line}: ${errors.join(" ")}`); };

function catalog(key: string, keys: string[], rows: Row[]) {
  const spec = catalogImportSpec(key); const seen = new Set<string>(); const out: Record<string, unknown>[] = [];
  cells(keys, rows).forEach((c, i) => { const p = spec.parseRow(c, undefined); if (!p.ok) return fail(key, i + 1, p.errors); if (seen.has(p.data.key)) return; seen.add(p.data.key); out.push(p.data.data); });
  return out;
}
const text = (v: unknown) => String(v ?? "").trim();

async function main() {
  const sheets = await readIntake(intakePath!); const legacy = parseLegacyExport(readFileSync(legacyPath!, "utf8"));
  const gcIntake = data(sheets["Kiểu gia công"]).filter((r) => text(r[0]) !== "Kiểu gia công").map((r) => [r[0] ?? null, r[1] ?? null, r[2] ?? null, r[3] ?? null] as Row);
  const processingTypes = catalog("processing-types", ["name", "note", "ratio", "stockRatio", "unit"], buildProcessingRows(gcIntake, legacy.processing));
  const groups = catalog("partner-groups", ["name"], data(sheets["Nhóm khách hàng"]).map((r) => r.slice(0, 1)));
  const warehouses = catalog("warehouses", ["name"], data(sheets["Kho"]).map((r) => r.slice(0, 1)));
  const vehicles = catalog("vehicles", ["plate"], data(sheets["Xe"]).map((r) => r.slice(0, 1)));
  const drivers = catalog("drivers", ["name", "isAssistant"], data(sheets["Lái xe & phụ xe"]).map((r) => r.slice(0, 2)));
  const routes = catalog("routes", ["name"], data(sheets["Tuyến giao hàng"]).map((r) => r.slice(0, 1)));
  const expenseTypes = catalog("expense-types", ["name"], data(sheets["Loại thu chi"]).map((r) => r.slice(0, 1)));
  const cashAccounts = catalog("cash-accounts", ["name", "type", "bankNo"], data(sheets["Ngân hàng & quỹ"]).map((r) => r.slice(0, 3)));

  // Công ty
  const kv = new Map(data(sheets["Công ty"]).map((r) => [text(r[0]), r[1]]).filter(([k]) => k) as [string, unknown][]);
  const company = { name: text(kv.get("Tên công ty")), address: text(kv.get("Địa chỉ")), phone: fixPhone((kv.get("Điện thoại") as string | number | null) ?? null), taxCode: text(kv.get("Mã số thuế")), bank: { bankName: text(kv.get("Ngân hàng")), accountNo: text(kv.get("Số tài khoản")), accountHolder: text(kv.get("Chủ tài khoản")), branch: text(kv.get("Chi nhánh")) === "không có" ? "" : text(kv.get("Chi nhánh")) } };

  // Mẫu in: người ký + chân phiếu (các dòng "Lưu ý" nằm ở cột B của các dòng liền sau, cột A trống). Chỉ hóa đơn bán hàng và phiếu giao (mặc định đề xuất, khách chưa xác nhận).
  const co = sheets["Công ty"] ?? []; const footAt = co.findIndex((r) => text(r[0]).startsWith("Ghi chú chân phiếu"));
  const footer = footAt < 0 ? "" : [text(co[footAt]![1]), ...co.slice(footAt + 1).filter((r) => !text(r[0])).map((r) => text(r[1]))].filter(Boolean).join("\n");
  const signer = text(kv.get("Người ký (in trên phiếu)")).replace(/\s+/g, " ").replace(/\(\s*tên tài kho[àa]n đăng nhập\s*\)/i, "(tên tài khoản đăng nhập)").replace(/^./, (c) => c.toUpperCase());
  const printTemplates = footer || signer ? [["SALE_INVOICE", "Hóa đơn bán hàng"], ["DELIVERY_NOTE", "Phiếu giao hàng"]].map(([docType, title]) => ({ docType, name: "Mẫu chuẩn", title, signerName: signer, footerNote: footer })) : [];
  if (footer.length > 300) throw new Error(`Chân phiếu dài ${footer.length} ký tự (> 300, form sửa mẫu in sẽ từ chối).`);

  // Người dùng: chỉ người có đủ họ tên + tên đăng nhập + vị trí
  const users = data(sheets["Người dùng"]).map((r) => ({ fullName: text(r[0]), username: text(r[1]), email: text(r[2]).toLowerCase(), role: text(r[3]) })).filter((u) => u.fullName && u.username && u.role);
  const owners = ownerMap(users.map((u, i) => ({ id: i + 1, username: u.username, fullName: u.fullName })));
  const groupIndex = new Map(groups.map((g, i) => [normalizeSearch(String(g.name)), i + 1])); const groupName = new Map(groups.map((g, i) => [i + 1, String(g.name)]));
  const partnerRows = (sheet: string, kind: "customer" | "supplier") => {
    const spec = partnerImportSpec(kind); const seen = new Set<string>(); const out: Record<string, unknown>[] = [];
    cells(["code", "name", "group", "phone", "address", "debtLimit", "allowCredit", "owner", "note"], data(sheets[sheet]).map((r) => { const x = r.slice(0, 9); x[3] = fixPhone(x[3] ?? null) || null; return x; })).forEach((c, i) => {
      const p = spec.parseRow(c, { groups: groupIndex, owners }); if (!p.ok) return fail(sheet, i + 1, p.errors); if (seen.has(p.data.code)) return; seen.add(p.data.code);
      const d = p.data; out.push({ code: d.code, name: d.name, kind, group: groupName.get(d.groupId), phone: d.phone, address: d.address, note: d.note, debtLimit: d.debtLimit, allowCredit: d.allowCredit, owner: d.ownerUserId ? users[d.ownerUserId - 1]!.username : null });
    });
    return out;
  };
  const partners = [...partnerRows("Khách hàng", "customer"), ...partnerRows("Nhà cung cấp", "supplier")];

  // Sản phẩm
  const productSheet = buildProductRows(data(sheets["Sản phẩm"]).map((r) => r.slice(0, 10)), legacy);
  const pspec = productImportSpec(); const seenP = new Set<string>(); const products: Record<string, unknown>[] = [];
  productSheet.rows.forEach((r, i) => {
    const p = pspec.parseRow(Object.fromEntries(["code", "name", "kind", "baseUnit", "minStock", "unit", "factor", "isCoil", "stopped", "note"].map((k, j) => [k, r[j] ?? null])), { groups: new Map() });
    if (!p.ok) return fail("Sản phẩm", i + 1, p.errors); if (seenP.has(p.data.code)) return fail("Sản phẩm", i + 1, ["Trùng mã."]); seenP.add(p.data.code);
    const d = p.data; products.push({ code: d.code, name: d.name, kind: d.kind, baseUnit: d.baseUnit, minStock: d.minStock, unit: d.unit, factor: d.factor, isCoil: d.isCoil, isActive: d.isActive, note: d.note });
  });

  const sections: Record<string, unknown[] | unknown> = { groups, warehouses, vehicles, drivers, routes, expenseTypes, cashAccounts, processingTypes, company, printTemplates, users, partners, products };
  const body = Object.entries(sections).map(([k, v]) => (Array.isArray(v) ? `  ${JSON.stringify(k)}: [\n${v.map((x) => `    ${JSON.stringify(x)}`).join(",\n")}\n  ]` : `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)).join(",\n");
  writeFileSync(outPath, `{\n  "version": 1,\n${body}\n}\n`, "utf8");
  console.log(`Đã ghi ${outPath}: ${Object.entries(sections).map(([k, v]) => `${k} ${Array.isArray(v) ? v.length : 1}`).join(", ")}`);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
