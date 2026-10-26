"use client";
import Link from "next/link";
import { DataTable, type Column } from "@/components/ui";
import { formatCurrency, formatDate, formatQty } from "@/lib/format";
import type { XntDetailRow } from "@/server/inventory-reports/xnt-detail";

/** Cột giá chỉ có khi người xem đủ quyền (server đã bỏ khóa nhạy cảm); không có dòng nào mang giá ⇒ ẩn cột. */
export function XntDetailTable({ rows, baseUnit }: { rows: XntDetailRow[]; baseUnit: string }) {
  const q = (v: string) => (v === "0" ? null : `${formatQty(v)} ${baseUnit}`);
  const hasInPrice = rows.some((r) => r.purchasePrice !== undefined || r.unitCost !== undefined), hasSalePrice = rows.some((r) => r.salePrice !== undefined), hasCostOut = rows.some((r) => r.unitCostOut !== undefined);
  const columns: Column<XntDetailRow>[] = [
    { key: "at", label: "Ngày", primaryOnMobile: true, render: (r) => formatDate(r.at) },
    { key: "label", label: "Chứng từ", render: (r) => { const text = <>{r.label}{r.code && <span className="ml-1 font-mono text-xs">{r.code}</span>}</>; return r.href ? <Link href={r.href} className="text-accent hover:underline">{text}</Link> : <span>{text}</span>; } },
    { key: "partner", label: "Khách hàng / NCC", render: (r) => r.partner ?? "—" },
    { key: "qtyIn", label: "SL nhập", align: "right", render: (r) => q(r.qtyIn) },
    ...(hasInPrice ? [{ key: "purchasePrice", label: `Giá nhập / ${baseUnit}`, align: "right" as const, render: (r: XntDetailRow) => (r.purchasePrice ?? r.unitCost) === undefined ? null : formatCurrency(r.purchasePrice ?? r.unitCost) }] : []),
    { key: "qtyOut", label: "SL xuất", align: "right", render: (r) => q(r.qtyOut) },
    ...(hasSalePrice ? [{ key: "salePrice", label: `Giá bán / ${baseUnit}`, align: "right" as const, render: (r: XntDetailRow) => r.salePrice === undefined ? null : formatCurrency(r.salePrice) }] : []),
    ...(hasCostOut ? [{ key: "unitCostOut", label: `Giá vốn xuất / ${baseUnit}`, align: "right" as const, render: (r: XntDetailRow) => r.unitCostOut === undefined ? null : formatCurrency(r.unitCostOut) }] : []),
    { key: "balance", label: "Tồn sau", align: "right", render: (r) => `${formatQty(r.balance)} ${baseUnit}` },
  ];
  return <DataTable id="stock-xnt-detail" columns={columns} rows={rows} rowKey={(r) => r.id} />;
}
