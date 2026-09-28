import { DataTable, type Column } from "@/components/ui";
import { formatDate, formatQty } from "@/lib/format";
import type { RollRow } from "@/server/inventory-reports/rolls";

/** DataTable giữ cơ chế bảng PC/card list mobile đồng nhất cho tra cứu cuộn. */
export function RollTable({ rows }: { rows: RollRow[] }) {
  const columns: Column<RollRow>[] = [
    { key: "at", label: "Ngày nhập", render: (row) => formatDate(row.at) },
    { key: "purchaseCode", label: "Phiếu", render: (row) => <span className="font-mono text-xs">{row.purchaseCode}</span> },
    { key: "product", label: "Sản phẩm", primaryOnMobile: true, render: (row) => <><span className="font-mono text-xs">{row.productCode}</span> {row.productName}</> },
    { key: "qty", label: "Số lượng", align: "right", render: (row) => `${formatQty(row.qty)} ${row.unit}` },
    { key: "rollInfo", label: "Ghi chú cuộn", render: (row) => row.rollInfo },
  ];
  return <DataTable id="roll-lookup" columns={columns} rows={rows} rowKey={(row) => row.id} />;
}
