"use client";
import { DataTable, type Column } from "@/components/ui";
import { formatQty } from "@/lib/format";
import type { XntRow } from "@/server/inventory-reports/xnt";
export function XntTable({ rows }: { rows: XntRow[] }) { const q = (v: string, u: string) => `${formatQty(v)} ${u}`; const columns: Column<XntRow>[] = [{ key: "code", label: "Mã", primaryOnMobile: true, render: (r) => <span className="font-mono text-xs">{r.code}</span> }, { key: "name", label: "Sản phẩm", render: (r) => r.name }, { key: "opening", label: "Tồn đầu", align: "right", render: (r) => q(r.opening, r.baseUnit) }, { key: "inQty", label: "Nhập", align: "right", render: (r) => q(r.inQty, r.baseUnit) }, { key: "outQty", label: "Xuất", align: "right", render: (r) => q(r.outQty, r.baseUnit) }, { key: "closing", label: "Tồn cuối", align: "right", render: (r) => q(r.closing, r.baseUnit) }]; return <DataTable id="stock-xnt" columns={columns} rows={rows} rowKey={(r) => r.productId} />; }
