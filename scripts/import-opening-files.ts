/**
 * Nhập các file Excel đã chuẩn bị (sản phẩm mới, khách, NCC, tồn đầu kỳ, công nợ đầu kỳ) qua ĐÚNG bộ nhập của hệ thống.
 *
 *   npx tsx scripts/import-opening-files.ts --dir <thư mục chứa các file .xlsx>                         # chỉ XEM TRƯỚC
 *   npx tsx scripts/import-opening-files.ts --dir … --commit --confirm-db <tên DB>                      # ghi thật
 *
 * DB lấy từ DATABASE_URL. Thứ tự: sản phẩm → khách → NCC → tồn kho → công nợ khách → công nợ NCC.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { loadActor } from "../src/server/auth/actor";
import { commitImport, previewImport } from "../src/server/import/framework";
import type { ImportSpec } from "../src/server/import/types";
import { openingMoneySpec } from "../src/server/opening/money";
import { openingStockSpec } from "../src/server/opening/stock";
import { partnerImportSpec } from "../src/server/partners/import-spec";
import { productImportSpec } from "../src/server/products/import-spec";

process.env.DATABASE_URL ? undefined : process.loadEnvFile(".env");
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const COMMIT = args.includes("--commit");

async function main() {
  const dir = arg("dir"); if (!dir) throw new Error("Thiếu --dir.");
  const url = new URL(process.env.DATABASE_URL ?? ""); const dbName = url.pathname.slice(1);
  console.log(`DB đích: ${url.hostname}:${url.port || 5432}/${dbName} — ${COMMIT ? "GHI THẬT" : "XEM TRƯỚC (không ghi)"}`);
  if (COMMIT && arg("confirm-db") !== dbName) throw new Error(`Ghi thật cần --confirm-db ${dbName}.`);
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { username: arg("as") ?? "admin" }, select: { id: true } });
    if (!user) throw new Error("Không có tài khoản (mặc định `admin`, đổi bằng --as).");
    const actor = (await loadActor(prisma, user.id))!;
    const steps = (arg("steps") ?? "products,customers,suppliers,stock,debt-customers,debt-suppliers").split(",");
    const overwrite = args.includes("--overwrite");
    const run = async (label: string, file: string, spec: ImportSpec<any, any>, buf?: Buffer) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const buffer = buf ?? readFileSync(join(dir, file));
      const pv = await previewImport(prisma, spec, buffer, { overwrite }); const c = pv.counts;
      console.log(`• ${label} (${file}): ${pv.total} dòng → tạo ${c.create}, đã có ${c["skip-existing"]}, bỏ qua ${c["skip-reason"]}, lỗi ${c.error}`);
      for (const r of pv.rows.filter((x) => x.status === "error").slice(0, 10)) console.log(`    dòng ${r.line}: ${r.message}`);
      if (!COMMIT) return;
      if (c.error > 0) throw new Error(`${label}: còn dòng lỗi — dừng, không ghi.`);
      const res = await commitImport(prisma, { userId: actor.userId, perms: actor.perms }, spec, buffer, { overwrite, idempotencyKey: `opening-oct22-${overwrite ? "ow-" : ""}${spec.entity}-${createHash("sha1").update(buffer).digest("hex").slice(0, 16)}` });
      console.log(`    ĐÃ GHI: tạo ${res.created}, bỏ qua ${res.skippedExisting + res.skippedReason}, lỗi ${res.failed}`);
    };
    const only = (s: string, fn: () => Promise<void>) => (steps.includes(s) ? fn() : Promise.resolve());
    await only("products", () => run("Sản phẩm mới", "1-san-pham-moi.xlsx", productImportSpec()));
    await only("customers", () => run("Khách hàng", "5-khach-hang.xlsx", partnerImportSpec("customer")));
    await only("suppliers", () => run("Nhà cung cấp", "8-nha-cung-cap.xlsx", partnerImportSpec("supplier")));
    // Tồn kho: chia lô nhỏ để mỗi giao dịch engine không quá thời gian (đường hầm SSH chậm); mỗi mã một lô OPENING nên chia lô không đổi kết quả.
    await only("stock", async () => {
      const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(join(dir, "2-ton-kho-dau-ky.xlsx")); const ws = wb.worksheets[0];
      const head = ws.getRow(1).values as unknown[]; const rows: unknown[][] = []; for (let i = 2; i <= ws.rowCount; i++) rows.push((ws.getRow(i).values as unknown[]).slice(1));
      const size = Number(arg("chunk") ?? 60);
      for (let at = 0; at < rows.length; at += size) {
        const out = new ExcelJS.Workbook(); const sh = out.addWorksheet("Mẫu nhập"); sh.addRow((head as unknown[]).slice(1)); rows.slice(at, at + size).forEach((r) => sh.addRow(r));
        await run(`Tồn kho lô ${at / size + 1}/${Math.ceil(rows.length / size)}`, "2-ton-kho-dau-ky.xlsx", openingStockSpec("stock", { actor, force: false }), Buffer.from(await out.xlsx.writeBuffer()));
      }
    });
    await only("debt-customers", () => run("Công nợ khách", "6-cong-no-dau-ky.xlsx", openingMoneySpec("debt", { actor, force: false })));
    await only("debt-suppliers", () => run("Công nợ NCC", "9-cong-no-ncc-dau-ky.xlsx", openingMoneySpec("debt", { actor, force: false })));
    await only("debt-fix-shared", () => run("Công nợ đối tác vừa là khách vừa là NCC (lấy số NCC)", "13-cong-no-trung-theo-ncc.xlsx", openingMoneySpec("debt", { actor, force: args.includes("--force") })));
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
