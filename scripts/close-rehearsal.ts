/**
 * DIỄN TẬP KẾT SỔ trên BẢN SAO DB (Plan 07 F3). Chạy trên DB đã khôi phục từ backup (xem docs/infra/RUNBOOK.md mục Kết sổ),
 * KHÔNG BAO GIỜ trên DB thật.
 *
 *   npx tsx scripts/close-rehearsal.ts --confirm-db <tên DB bản sao> --user <username có quyền period.close>             # chỉ XEM: checklist + số sẽ chuyển
 *   npx tsx scripts/close-rehearsal.ts --confirm-db <tên DB bản sao> --user <username> --commit [--new-name "Kỳ 10/2026"]   # kết sổ THẬT trên bản sao, in so sánh trước/sau
 *
 * DB lấy từ DATABASE_URL (biến môi trường hoặc .env). Từ chối nếu: tên DB gõ lại không khớp; tên DB là `dherp_db`
 * (DB thật); tên DB không có dấu hiệu bản sao (drill|copy|rehearsal|restore|test|sandbox|local) trừ khi có `--force-name`.
 * Thoát 0 = số trước/sau khớp hoàn toàn (hoặc chỉ xem). ≠ 0 = lệch/lỗi — KHÔNG kết sổ thật.
 */
import { PrismaClient } from "@prisma/client";
import { loadActor } from "../src/server/auth/actor";
import { closePeriod } from "../src/server/closing/service";
import { getCloseChecklist } from "../src/server/period/close-checklist";
import { previewClosing } from "../src/server/period/close";
import { captureTotals, diffTotals } from "../src/server/period/rehearsal";

process.env.DATABASE_URL ? undefined : process.loadEnvFile(".env");
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const COMMIT = args.includes("--commit");
const log = (...a: unknown[]) => console.log(...a);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Thiếu DATABASE_URL.");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (arg("confirm-db") !== dbName) throw new Error(`Gõ lại đúng tên DB: --confirm-db ${dbName}`);
  if (dbName === "dherp_db") throw new Error("Đây là DB THẬT (dherp_db). Diễn tập chỉ chạy trên bản sao khôi phục.");
  if (!/(drill|copy|rehearsal|restore|test|sandbox|local)/i.test(dbName) && !args.includes("--force-name")) {
    throw new Error(`Tên DB "${dbName}" không giống bản sao. Đổi tên cho rõ ràng, hoặc thêm --force-name nếu chắc chắn đây là bản sao.`);
  }
  const username = arg("user");
  if (!username) throw new Error("Thiếu --user <username có quyền period.close>.");

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!user) throw new Error(`Không có user "${username}".`);
    const actor = await loadActor(prisma, user.id);
    if (!actor?.perms.has("period.close")) throw new Error(`User "${username}" không có quyền period.close.`);

    const checklist = await getCloseChecklist(prisma);
    log(`Kỳ đang mở: ${checklist.period.name} (#${checklist.period.id}) — chặn ${checklist.blockerCount}, cảnh báo ${checklist.warningCount}`);
    for (const f of [...checklist.blockers, ...checklist.warnings].filter((x) => x.count > 0)) log(`  ${f.severity === "BLOCK" ? "CHẶN" : "cảnh báo"} ${f.title}: ${f.count}`);
    const preview = await previewClosing(prisma, checklist.period.id);
    log(`Sẽ chuyển sang kỳ mới: ${preview.stock.lots} lô / ${preview.stock.products} mã (SL ${preview.stock.qty}, giá trị ${preview.stock.value}); phải thu ${preview.receivable.total} (${preview.receivable.partners} đối tác); phải trả ${preview.payable.total} (${preview.payable.partners}); ${preview.cash.length} quỹ; chiết khấu ${preview.discount.total}.`);
    if (!COMMIT) { log("\nChỉ xem (không có --commit): chưa ghi gì."); return 0; }
    if (checklist.blockerCount > 0) throw new Error("Còn mục chặn — xử lý trước khi diễn tập kết sổ.");

    log("\nChụp số liệu TRƯỚC kết sổ…");
    const before = await captureTotals(prisma, actor);
    const t0 = Date.now();
    const out = await closePeriod(prisma, actor, { ...(arg("new-name") ? { newName: arg("new-name")! } : {}), auditExtra: { rehearsal: true } });
    log(`Kết sổ xong trong ${Date.now() - t0} ms → kỳ mới "${out.newPeriod.name}" (#${out.newPeriod.id}); mang sang ${out.carried.draftOrders} đơn nháp, ${out.carried.quotes} báo giá.`);
    log("Chụp số liệu SAU kết sổ (đọc bằng các hàm báo cáo của ứng dụng)…");
    const after = await captureTotals(prisma, actor);
    const diffs = diffTotals(before, after);
    log(`\nSo sánh: ${Object.keys(before.stock).length} mã tồn, ${Object.keys(before.debt).length} đối tác có công nợ, ${Object.keys(before.cash).length} quỹ, ${Object.keys(before.discount).length} đối tác có chiết khấu.`);
    if (diffs.length === 0) { log("ĐẠT: trước = sau ở mọi chỉ tiêu."); return 0; }
    log(`KHÔNG ĐẠT: ${diffs.length} chỉ tiêu lệch:`);
    for (const d of diffs.slice(0, 50)) log(`  ${d.what} [${d.key}]: ${d.before} → ${d.after}`);
    return 2;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((code) => process.exit(code), (e) => { console.error("LỖI:", e instanceof Error ? e.message : e); process.exit(1); });
