"use client";

import { DataTable, type Column } from "@/components/ui";
import { formatDate, formatQty } from "@/lib/format";
import type { StockCardRow } from "@/server/inventory-reports/stock-card";

const documentLabel: Record<string, string> = {
  PURCHASE: "Phiếu nhập hàng",
  STOCK_ADJUSTMENT: "Nhập kho không NCC",
  OPENING: "Số đầu kỳ",
  SALE: "Xuất bán",
  RETURN: "Trả hàng",
  PRODUCTION: "Sản xuất",
};

export function StockCardTable({ rows, baseUnit }: { rows: StockCardRow[]; baseUnit: string }) {
  const columns: Column<StockCardRow>[] = [
    { key: "at", label: "Ngày", render: (row) => formatDate(row.at) },
    { key: "document", label: "Chứng từ", render: (row) => documentLabel[row.docType] ?? row.docType },
    { key: "qtyIn", label: "Nhập", align: "right", render: (row) => row.qtyIn === "0" ? null : `${formatQty(row.qtyIn)} ${baseUnit}` },
    { key: "qtyOut", label: "Xuất", align: "right", render: (row) => row.qtyOut === "0" ? null : `${formatQty(row.qtyOut)} ${baseUnit}` },
    { key: "balance", label: "Tồn sau ghi sổ", align: "right", render: (row) => `${formatQty(row.balance)} ${baseUnit}` },
  ];
  return <DataTable id="stock-ledger" columns={columns} rows={rows} rowKey={(row) => row.id} />;
}
