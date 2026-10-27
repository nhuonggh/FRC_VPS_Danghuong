/**
 * Sửa công nợ giao hàng của các đơn đã giao TRƯỚC bản sửa "chia phần chênh làm tròn tổng ÂM vào phiếu giao"
 * (đơn làm tròn xuống, vd 19.520.200 → 19.520.000, từng ghi công nợ/phải thu chuyến theo tổng chưa làm tròn).
 *
 *   npx tsx scripts/fix-delivery-rounding.ts --confirm-db <tên DB>                          # chỉ XEM: liệt kê phiếu lệch, KHÔNG ghi gì
 *   npx tsx scripts/fix-delivery-rounding.ts --confirm-db <tên DB> --user <username> --commit   # ghi lại công nợ các đơn lệch
 *
 * DB lấy từ DATABASE_URL (biến môi trường hoặc .env). Phải gõ lại đúng tên DB. Đơn có phiếu giao ở kỳ đã kết sổ bị bỏ qua.
 * KHÔNG sửa "phải thu" đã chốt của chuyến giao (TripOrder.dueAmount) — in ra danh sách chuyến liên quan để xử lý riêng.
 * Nên chạy chế độ xem trước, sao lưu DB, rồi mới --commit.
 */
import { PrismaClient } from "@prisma/client";
import { findDeliveryMismatches, repairDeliveryMismatches } from "../src/server/delivery/repair-rounding";

process.env.DATABASE_URL ? undefined : process.loadEnvFile(".env");
const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const COMMIT = args.includes("--commit");
const fmt = (v: string) => Number(v).toLocaleString("vi-VN");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Thiếu DATABASE_URL.");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (arg("confirm-db") !== dbName) throw new Error(`Gõ lại đúng tên DB: --confirm-db ${dbName}`);
  const prisma = new PrismaClient();
  try {
    const found = await findDeliveryMismatches(prisma);
    if (!found.length) { console.log("Không có phiếu giao nào lệch."); return; }
    console.log(`${found.length} phiếu giao lệch (${new Set(found.map((m) => m.orderId)).size} đơn):`);
    for (const m of found) console.log(`  ${m.orderCode} · ${m.noteCode}: đang ${fmt(m.current)} → đúng ${fmt(m.expected)}${m.periodOpen ? "" : "  [kỳ đã kết sổ — sẽ bỏ qua]"}`);
    const trips = await prisma.tripOrder.findMany({ where: { orderId: { in: [...new Set(found.map((m) => m.orderId))] }, result: { not: null } }, select: { dueAmount: true, order: { select: { code: true } }, trip: { select: { code: true, status: true } } } });
    if (trips.length) console.log("Chuyến giao đã nhập kết quả (phải thu đã chốt, KHÔNG tự sửa):\n" + trips.map((t) => `  ${t.trip.code} (${t.trip.status}) · ${t.order.code}: phải thu ${fmt(String(t.dueAmount ?? 0))}`).join("\n"));
    if (!COMMIT) { console.log("\nChỉ xem. Thêm --user <username> --commit để ghi lại công nợ."); return; }
    const username = arg("user");
    if (!username) throw new Error("Thiếu --user <username> (người thực hiện, ghi vào nhật ký).");
    const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!user) throw new Error(`Không có user "${username}".`);
    const result = await prisma.$transaction((tx) => repairDeliveryMismatches(tx, { userId: user.id, perms: new Set() }, found), { timeout: 120_000 });
    console.log(`\nĐã ghi lại công nợ ${result.fixed.length} đơn.${result.skipped.length ? ` Bỏ qua ${result.skipped.length} đơn thuộc kỳ đã kết sổ (id: ${result.skipped.join(", ")}).` : ""}`);
    const after = await findDeliveryMismatches(prisma, result.fixed);
    console.log(after.length ? `CÒN ${after.length} phiếu lệch sau khi sửa — kiểm tra lại.` : "Kiểm tra lại: các đơn đã sửa khớp công thức.");
    if (after.length) process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : "Lỗi không xác định."); process.exitCode = 1; });
