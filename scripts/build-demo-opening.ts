/**
 * Sinh src/server/opening/demo-data.json — SỐ DEMO để test (công nợ đầu kỳ lấy từ cột số dư file khách, tồn kho/quỹ/chiết khấu là số giả định).
 * Nạp/reset bằng nút "Số liệu demo" ở các màn số đầu kỳ (không đi theo deploy). Mọi dòng nạp có isDemo = true.
 *
 *   npx tsx scripts/build-demo-opening.ts --customers <xlsx>
 */
import { readFileSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";

const args = process.argv.slice(2);
const customersPath = args[args.indexOf("--customers") + 1];
if (!customersPath) throw new Error("Thiếu --customers.");
const seed = JSON.parse(readFileSync("prisma/data/customer-seed.json", "utf8")) as {
  partners: { code: string; kind: string; isCustomer?: boolean }[];
  products: { code: string; baseUnit: string; note: string; group: string | null }[];
  cashAccounts: { name: string }[];
};

/** "giá nhập 33.000" (số kiểu VN) → 33000. */
const buyPrice = (note: string) => { const m = /giá nhập ([\d.]+)/.exec(note); return m ? Number(m[1]!.replace(/\./g, "")) : 0; };
const qtyFor = (unit: string) => ({ "cây": 50, "tấm": 50, "kg": 200, "m": 300, "cái": 100, "bộ": 50, "túi": 100, "chiếc": 100 } as Record<string, number>)[unit] ?? 100;

async function main() {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(customersPath!);
  const debts: { code: string; amount: number }[] = [];
  const codes = new Set(seed.partners.map((p) => p.code));
  wb.worksheets[0]!.eachRow((r, i) => {
    if (i === 1) return; const v = r.values as unknown[]; const code = String(v[1] ?? "").trim(); const amount = Number(v[13]) || 0;
    if (code && amount && codes.has(code)) debts.push({ code, amount });
  });

  // ~3 sản phẩm / nhóm hàng có giá nhập, để đủ loại hàng khi test bán
  const perGroup = new Map<string, number>(); const stock: { code: string; qty: number; unitCost: number }[] = [];
  for (const p of seed.products) {
    const cost = buyPrice(p.note); if (!cost) continue;
    const g = p.group ?? "(khác)"; const n = perGroup.get(g) ?? 0; if (n >= 3) continue;
    perGroup.set(g, n + 1); stock.push({ code: p.code, qty: qtyFor(p.baseUnit), unitCost: cost });
  }
  const customers = seed.partners.filter((p) => p.isCustomer ?? p.kind === "customer").slice(0, 3);
  const discounts = customers.map((p, i) => ({ code: p.code, amount: (i + 1) * 500_000 }));
  const cashAmounts = [50_000_000, 150_000_000, 30_000_000];
  const cash = seed.cashAccounts.map((a, i) => ({ name: a.name, amount: cashAmounts[i] ?? 10_000_000 }));

  const out = { version: 1, note: "Số demo để test — reset khi chạy chính thức", debts, stock, cash, discounts };
  writeFileSync("src/server/opening/demo-data.json", JSON.stringify(out, null, 1) + "\n", "utf8");
  console.log(`debts ${debts.length}, stock ${stock.length}, cash ${cash.length}, discounts ${discounts.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
