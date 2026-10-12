import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { buildXlsx, type XlsxColumn } from "@/server/export/xlsx";
import { onHandList } from "./on-hand";
import { rollLookup } from "./rolls";
import { stockCardList } from "./stock-card";
import { xntList } from "./xnt";

const qty = { numFmt: "#,##0.###" } as const;
const money = { numFmt: "#,##0 \"₫\"" } as const;

export async function exportOnHandXlsx(db: PrismaClient, actor: Actor, params: ListParams, belowMinOnly = false) {
  const { rows } = await onHandList(db, actor, params, { belowMinOnly, unpaged: true });
  const withValue = rows.some((row) => row.stockValue !== undefined);
  const columns: XlsxColumn[] = [{ header: "Mã", key: "code", text: true }, { header: "Sản phẩm", key: "name", width: 32 }, { header: "Đơn vị", key: "baseUnit" }, { header: "Định mức tồn", key: "minStock", ...qty }, { header: "Tồn hiện tại", key: "onHand", ...qty }, ...(withValue ? [{ header: "Giá trị tồn", key: "stockValue", ...money }] : [])];
  return buildXlsx(belowMinOnly ? "Định mức tồn" : "Tồn kho", columns, rows.map((row) => ({ ...row })));
}

export async function exportXntXlsx(db: PrismaClient, actor: Actor, from: Date, to: Date, q?: string) {
  const { rows } = await xntList(db, actor, { from, to, q, page: 1, pageSize: Number.MAX_SAFE_INTEGER });
  const withValue = rows.some((row) => row.closingValue !== undefined);
  return buildXlsx("Xuất nhập tồn", [
    { header: "Mã", key: "code", text: true }, { header: "Sản phẩm", key: "name", width: 32 }, { header: "Đơn vị", key: "baseUnit" },
    { header: "Tồn đầu", key: "opening", ...qty }, { header: "Nhập", key: "inQty", ...qty }, { header: "Xuất", key: "outQty", ...qty }, { header: "Tồn cuối", key: "closing", ...qty },
    ...(withValue ? [
      { header: "Giá trị tồn đầu", key: "openingValue", ...money }, { header: "Giá trị nhập", key: "inValue", ...money },
      { header: "Giá trị xuất", key: "outValue", ...money }, { header: "Giá trị tồn cuối", key: "closingValue", ...money },
    ] : []),
  ], rows.map((row) => ({ ...row })));
}

export async function exportStockCardXlsx(db: PrismaClient, actor: Actor, productId: number, from?: Date, to?: Date) {
  const [product, result] = await Promise.all([db.product.findUniqueOrThrow({ where: { id: productId }, select: { code: true, name: true, baseUnit: true } }), stockCardList(db, actor, productId, { from, to, page: 1, pageSize: Number.MAX_SAFE_INTEGER })]);
  const rows = result.rows;
  const withCost = rows.some((row) => row.unitCost !== undefined);
  return buildXlsx("Thẻ kho", [{ header: "Ngày", key: "at" }, { header: "Loại chứng từ", key: "docType" }, { header: "ID chứng từ", key: "docId" }, { header: `Nhập (${product.baseUnit})`, key: "qtyIn", ...qty }, { header: `Xuất (${product.baseUnit})`, key: "qtyOut", ...qty }, { header: `Tồn (${product.baseUnit})`, key: "balance", ...qty }, ...(withCost ? [{ header: "Giá vốn", key: "unitCost", ...money }] : [])], rows.map((row) => ({ ...row, product: `${product.code} — ${product.name}` })));
}

export async function exportRollsXlsx(db: PrismaClient, q: string) {
  const rows = await rollLookup(db, q);
  return buildXlsx("Tra cứu cuộn", [{ header: "Ngày nhập", key: "at" }, { header: "Phiếu nhập", key: "purchaseCode", text: true }, { header: "Mã sản phẩm", key: "productCode", text: true }, { header: "Sản phẩm", key: "productName", width: 32 }, { header: "Số lượng", key: "qty", ...qty }, { header: "Đơn vị", key: "unit" }, { header: "Kiểu gia công", key: "processingTypeName", width: 22 }, { header: "Ghi chú cuộn", key: "rollInfo", width: 36 }], rows.map((row) => ({ ...row })));
}
