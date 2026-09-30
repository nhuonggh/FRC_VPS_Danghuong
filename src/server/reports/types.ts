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
}
export const REPORTS = [
  { key: "order-profit", code: "67", title: "Lãi từng đơn", perm: "profit.view" },
  { key: "period-pnl", code: "68", title: "Lãi lỗ toàn xưởng", perm: "profit.view" },
  { key: "by-customer", code: "69", title: "Bán hàng theo khách", perm: "report.view" },
  { key: "by-group", code: "70", title: "Bán hàng theo nhóm khách", perm: "report.view" },
  { key: "issue-by-order", code: "71", title: "Xuất kho theo đơn", perm: "report.view" },
  { key: "debt-reconciliation", code: "73", title: "Đối chiếu công nợ", perm: "report.view" },
] as const;
export type ReportKey = (typeof REPORTS)[number]["key"];
export const REPORT_FILTER_KEYS = ["neg"] as const;
