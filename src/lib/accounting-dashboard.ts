/** Shared configuration for accounting navigation and report grouping. */
export const ACCOUNTING_SECTIONS = [
  { key: "bank", label: "Kiểm tra tiền ngân hàng", description: "Theo dõi tiền ghi sổ và phiếu thu ngân hàng cần xử lý trong khoảng đã chọn.", perms: ["cashbook.view", "receipt.manage"], snapshot: false, kpis: [], widgets: [] },
  { key: "cashflow", label: "Thu chi", description: "Thu chi trên tất cả tài khoản trong khoảng thời gian đã chọn.", perms: ["cashbook.view", "receipt.manage", "payment.manage"], snapshot: false, kpis: ["in", "out", "net"], widgets: ["monthly", "out-mix", "in-mix", "daily", "review"] },
  { key: "debt", label: "Công nợ", description: "Công nợ phải thu và phải trả hiện tại trong kỳ đang mở.", perms: ["debt.view"], snapshot: true, kpis: ["receivable", "payable"], widgets: ["receivable", "payable"] },
  { key: "funds", label: "Số dư Quỹ", description: "Số dư tiền mặt và tài khoản ngân hàng hiện tại trong kỳ đang mở.", perms: ["cashbook.view"], snapshot: true, kpis: ["cash"], widgets: ["accounts"] },
] as const;

export type AccountingSection = (typeof ACCOUNTING_SECTIONS)[number]["key"];

export function visibleAccountingSections(perms: ReadonlySet<string>) {
  return ACCOUNTING_SECTIONS.filter((s) => s.perms.some((p) => perms.has(p)));
}

export function resolveAccountingSection(perms: ReadonlySet<string>, requested?: string) {
  const sections = visibleAccountingSections(perms);
  return sections.find((s) => s.key === requested) ?? sections[0];
}
