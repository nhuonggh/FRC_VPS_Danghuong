import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { buildXlsx, type XlsxColumn } from "@/server/export/xlsx";
import { purchaseWhere } from "./queries";

const MAX_EXPORT = 20_000;

export async function exportPurchasesXlsx(
  db: Prisma.TransactionClient | PrismaClient,
  actor: Actor,
  params: ListParams,
): Promise<Buffer> {
  const showPrice = actor.perms.has("purchase_price.view");
  const rows = await db.purchase.findMany({
    where: await purchaseWhere(db, params),
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: MAX_EXPORT,
    include: { partner: { select: { code: true, name: true } }, _count: { select: { lines: true } } },
  });
  const columns: XlsxColumn[] = [
    { header: "Mã phiếu", key: "code", width: 14, text: true },
    { header: "Ngày", key: "at", width: 14 },
    { header: "Mã NCC", key: "partnerCode", width: 14, text: true },
    { header: "Nhà cung cấp", key: "partnerName", width: 30 },
    { header: "Số dòng", key: "lineCount", width: 10 },
    ...(showPrice ? [
      { header: "Tổng tiền hàng", key: "purchaseTotal", width: 18, numFmt: "#,##0" },
      { header: "Cước", key: "freightCost", width: 14, numFmt: "#,##0" },
    ] : []),
    { header: "Trạng thái", key: "status", width: 12 },
    { header: "Ghi chú", key: "note", width: 30 },
  ];
  return buildXlsx("Phiếu nhập", columns, rows.map((purchase) => ({
    code: purchase.code, at: purchase.at, partnerCode: purchase.partner.code, partnerName: purchase.partner.name,
    lineCount: purchase._count.lines,
    ...(showPrice ? { purchaseTotal: purchase.purchaseTotal, freightCost: purchase.freightCost } : {}),
    status: purchase.isCancelled ? "Đã hủy" : "Hiệu lực", note: purchase.note,
  })));
}
