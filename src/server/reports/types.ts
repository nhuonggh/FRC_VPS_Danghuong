/** Khung báo cáo chung: cột + hàng + dòng tổng — màn hình và xuất Excel dùng cùng dữ liệu. */
export type ColKind = "text" | "money" | "qty" | "pct" | "date" | "int";
export interface ReportColumn { key: string; label: string; kind: ColKind; align?: "left" | "right" }
export type Cell = string | number | null;
export interface ReportResult {
  key: string; title: string; subtitle?: string; columns: ReportColumn[];
  rows: Record<string, Cell>[]; totals?: Record<string, Cell>;
  /** Cột có giá trị ÂM thì bôi đỏ cả dòng (vd lãi âm). */
  negativeKey?: string;
  total: number;
  notes?: string[];
  summary?: { label: string; value: string | number | null; money?: boolean; tone?: "neutral" | "success" | "warning" | "danger" | "info" }[];
  customers?: { value: string; label: string }[];
  orderDetail?: { id: number; code: string; date: string; customer: string; figures: Record<string, Cell>; lines: Record<string, Cell>[] } | null;
}
export const REPORTS = [
  { key: "order-profit", code: "67", title: "Lãi từng đơn", perm: "order.analysis.view" },
  { key: "period-pnl", code: "68", title: "Lãi lỗ toàn xưởng", perm: "order.analysis.view" },
  { key: "profit-by-group", code: "74", title: "Lãi theo nhóm hàng", perm: "order.analysis.view" },
  { key: "profit-by-processing", code: "75", title: "Lãi theo kiểu gia công", perm: "order.analysis.view" },
  { key: "by-customer", code: "69", title: "Bán hàng theo khách", perm: "report.view" },
  { key: "by-group", code: "70", title: "Bán hàng theo nhóm khách", perm: "report.view" },
  { key: "by-product", code: "76", title: "Bán hàng theo sản phẩm", perm: "report.view" },
  { key: "issue-by-order", code: "71", title: "Xuất kho theo đơn", perm: "report.view" },
  { key: "debt-reconciliation", code: "73", title: "Đối chiếu công nợ", perm: "report.view" },
  { key: "production", code: "72", title: "Báo cáo sản xuất", perm: "report.view" },
  { key: "actual-consumption", code: "52", title: "Tiêu hao thực tế", perm: "bom.manage" },
  { key: "consumption-compare", code: "53", title: "Đối chiếu định mức", perm: "bom.manage" },
] as const;
export type ReportKey = (typeof REPORTS)[number]["key"];
export const REPORT_FILTER_KEYS = ["neg", "customer", "order", "item"] as const;
