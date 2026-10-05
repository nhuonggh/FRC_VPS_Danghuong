/**
 * Đóng gói file khách đợt 2 (Danh sách khách hàng.xlsx + DANH SÁCH SẢN PHẨM.xlsx) vào prisma/data/customer-seed.json (version 2).
 * Giữ nguyên danh mục/công ty/người dùng/mẫu in của bản v1 (đọc từ chính file JSON cũ), THAY khách/NCC + sản phẩm + kiểu gia công.
 *
 *   npx tsx scripts/build-customer-seed-v2.ts --customers <xlsx> --products <xlsx> [--out prisma/data/customer-seed.json] [--report <txt>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { normalizeSearch } from "../src/lib/search";
import { fixPhone, fmtVi, sanitizeCode } from "./lib/customer-data";

const args = process.argv.slice(2);
const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const [custPath, prodPath] = [arg("customers"), arg("products")]; const outPath = arg("out") ?? "prisma/data/customer-seed.json"; const reportPath = arg("report");
if (!custPath || !prodPath) throw new Error("Thiếu --customers và --products.");

type Cell = string | number | boolean | Date | null;
const cellValue = (v: ExcelJS.CellValue): Cell => {
  if (v == null) return null;
  if (typeof v === "object" && !(v instanceof Date)) { if ("result" in v) return (v.result as Cell) ?? null; if ("richText" in v) return v.richText.map((t) => t.text).join(""); return null; } // công thức không có kết quả ⇒ trống
  return v as Cell;
};
async function readRows(file: string): Promise<Cell[][]> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file); const rows: Cell[][] = [];
  wb.worksheets[0]!.eachRow((r, i) => { if (i > 1) rows.push((r.values as ExcelJS.CellValue[]).slice(1).map(cellValue)); });
  return rows;
}
const text = (v: Cell | undefined) => (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
const report: string[] = [];

/** SĐT: bỏ ô rác (chỉ dấu chấm / < 8 chữ số), thêm số 0 đầu cho từng số bị Excel làm mất. */
const phoneOf = (v: Cell | undefined) => {
  const raw = text(v); if (raw.replace(/\D/g, "").length < 8) return "";
  return raw.split(/\s+-\s*|\s*-\s+/).map((p) => fixPhone(p.trim())).join(" - ");
};

async function main() {
  const base = JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown> & { users: { fullName: string; username: string }[]; groups: { name: string }[] };
  const ownerOf = new Map(base.users.map((u) => [normalizeSearch(u.fullName), u.username]));

  // ── Khách hàng / NCC ──
  const crows = (await readRows(custPath!)).filter((r) => text(r[0]));
  const groupNames = new Map<string, string>(base.groups.map((g) => [normalizeSearch(g.name), g.name]));
  const partners = crows.map((r) => {
    const group = text(r[2]); const key = normalizeSearch(group);
    if (!groupNames.has(key)) groupNames.set(key, group);
    const isCustomer = r[13] === true, isSupplier = r[14] === true || key === "nha cung cap";
    const owner = ownerOf.get(normalizeSearch(text(r[3]))) ?? null;
    if (text(r[3]) && !owner) report.push(`Người phụ trách "${text(r[3])}" chưa có tài khoản — khách để chưa phân công: ${text(r[0])}`);
    const address = text(r[7]).replace(/^\.+$/, "");
    return { code: text(r[0]), name: text(r[1]), kind: (isCustomer || !isSupplier ? "customer" : "supplier") as "customer" | "supplier", isCustomer: isCustomer || !isSupplier, isSupplier, group: groupNames.get(key)!, phone: phoneOf(r[6]), address, note: text(r[10]).replace(/^\.+$/, ""), debtLimit: String(Number(r[4]) || 0), allowCredit: text(r[5]) === "Có", owner, openingBalance: Number(r[12]) || 0 };
  });
  for (const p of partners) if (!/^[A-Za-z0-9._-]{1,30}$/.test(p.code)) throw new Error(`Mã khách không hợp lệ: ${p.code}`);
  if (new Set(partners.map((p) => p.code.toLowerCase())).size !== partners.length) throw new Error("Trùng mã khách.");

  // ── Sản phẩm + kiểu gia công ──
  const prows = await readRows(prodPath!);
  const isGc = (r: Cell[]) => text(r[1]) === "Kiểu gia công";
  const gcById = new Map<string, Cell[][]>();
  for (const r of prows.filter(isGc)) gcById.set(String(r[0]), [...(gcById.get(String(r[0])) ?? []), r]);
  const productGroups = new Map<string, string>(); const used = new Set<string>(); const names = new Set<string>(); const codeMap: string[] = [];
  const processingMap = new Map<string, { name: string; note: string }>(); const badStockRatio: string[] = [];
  const products = prows.filter((r) => !isGc(r) && text(r[1])).map((r) => {
    const rawCode = text(r[2]); const code = sanitizeCode(rawCode, used); if (code !== rawCode.toUpperCase()) codeMap.push(`${rawCode} => ${code}`);
    let name = text(r[1]); for (let i = 2; names.has(normalizeSearch(name)); i++) name = `${text(r[1])} (${i})`; names.add(normalizeSearch(name));
    const groupRaw = text(r[3]).replace(/^Phụ kiên/i, "Phụ kiện"); if (groupRaw) productGroups.set(normalizeSearch(groupRaw), groupRaw);
    const kindText = normalizeSearch(text(r[18])); const kind = kindText.startsWith("thanh pham") ? "THANH_PHAM" : /^phu kien/.test(normalizeSearch(groupRaw)) ? "PHU_KIEN" : "HANG";
    const unit = text(r[10]).toLowerCase() || "cái";
    const gcs = (gcById.get(String(r[0])) ?? []).map((g) => {
      const gname = text(g[6]); const stock = g[7]; const ratio = Number(g[8]) || 0; const gunit = text(g[9]);
      if (stock instanceof Date) badStockRatio.push(`${code} / ${gname}`);
      if (gname && !processingMap.has(normalizeSearch(gname))) processingMap.set(normalizeSearch(gname), { name: gname, note: ratio ? `Tỷ lệ ${fmtVi(ratio)}${gunit ? ` ${gunit}` : ""} (theo sản phẩm đầu tiên dùng kiểu này)` : "" });
      return `${gname} (×${fmtVi(ratio)} ${gunit})`;
    });
    const buy = Number(r[13]) || 0, sell = Number(r[14]) || 0;
    const note = [buy || sell ? ["[Bảng khách]", buy ? `giá nhập ${fmtVi(buy)}` : "", sell ? `giá bán ${fmtVi(sell)}` : ""].filter(Boolean).join(" ") : "", gcs.length ? `Kiểu gia công: ${gcs.join("; ")}.` : ""].filter(Boolean).join(" ");
    return { code, name, kind, baseUnit: unit, minStock: "0", unit: "", factor: null as string | null, isCoil: false, isActive: true, note, group: groupRaw || null };
  });
  if (products.some((p) => p.code.length > 30)) throw new Error("Có mã sản phẩm > 30 ký tự.");

  const merged = { ...base, version: 2 as const, groups: [...groupNames.values()].map((name) => ({ name })), productGroups: [...productGroups.values()].map((name) => ({ name })), processingTypes: [...processingMap.values()], partners: partners.map(({ openingBalance: _o, ...p }) => p), products };
  const sections = Object.entries(merged);
  const body = sections.map(([k, v]) => (Array.isArray(v) ? `  ${JSON.stringify(k)}: [\n${v.map((x) => `    ${JSON.stringify(x)}`).join(",\n")}\n  ]` : `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)).join(",\n");
  writeFileSync(outPath, `{\n${body}\n}\n`.replace(/^\{\n {2}"version": 2,\n/, '{\n  "version": 2,\n'), "utf8");
  const debts = partners.filter((p) => p.openingBalance).map((p) => `${p.code}\t${p.name}\t${p.openingBalance}`);
  console.log(`Đã ghi ${outPath}: khách/NCC ${partners.length}, sản phẩm ${products.length}, nhóm hàng ${productGroups.size}, kiểu gia công ${processingMap.size}`);
  if (reportPath) writeFileSync(reportPath, [`# Đổi mã sản phẩm (${codeMap.length})`, ...codeMap, "", `# Dòng gia công có tỷ lệ trừ kho bị Excel đổi thành ngày (${badStockRatio.length})`, ...badStockRatio, "", `# Cảnh báo`, ...report, "", `# Số dư công nợ đầu kỳ chưa nạp (${debts.length}; dương = khách nợ?)`, ...debts].join("\n"), "utf8");
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
