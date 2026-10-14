import type { PermissionCode } from "@/lib/permissions/catalog";
import type { Actor } from "@/lib/permissions/scope";
import { can } from "@/lib/permissions/guard";
import type { TimePreset } from "@/lib/time-presets";
import { resolveAccountingSection } from "@/lib/accounting-dashboard";
import { loadAccounting } from "./accounting";
import { dashRange, type Db } from "./common";
import { loadDelivery } from "./delivery";
import { loadInventory } from "./inventory";
import { loadProduction } from "./production";
import { loadPurchase } from "./purchase";
import { loadReturns } from "./returns";
import { loadSales } from "./sales";
import type { DashTabKey, Dashboard } from "./types";

export interface DashTabDef {
  key: DashTabKey;
  label: string;
  /** Có BẤT KỲ quyền nào trong danh sách là thấy tab. */
  perms: readonly PermissionCode[];
  /** Tab phản ánh "hiện tại" (kỳ đang mở), không đổi theo bộ lọc thời gian. */
  snapshot?: boolean;
}

/** Thứ tự tab = thứ tự user giao (tab 1 "Chức năng" do trang chủ tự thêm, không nằm ở đây). */
export const DASH_TABS: readonly DashTabDef[] = [
  { key: "sales", label: "Bán hàng", perms: ["order.view"] },
  { key: "delivery", label: "Giao hàng", perms: ["trip.manage", "trip.settle", "trip.confirm_cash"] },
  { key: "purchase", label: "Nhập hàng", perms: ["purchase.view"] },
  { key: "inventory", label: "Kho", perms: ["stock.view"], snapshot: true },
  { key: "returns", label: "Trả hàng", perms: ["return.manage"] },
  { key: "production", label: "Sản xuất", perms: ["production.manage"] },
  { key: "accounting", label: "Kế toán", perms: ["cashbook.view", "receipt.manage", "payment.manage", "debt.view"] },
];

/** Tab actor được xem — kiểm ở SERVER; tab không đủ quyền không có trong danh sách (URL ?tab= trỏ vào cũng bị bỏ qua). */
export function visibleDashTabs(actor: Actor): DashTabDef[] {
  return DASH_TABS.filter((t) => t.perms.some((p) => can(actor.perms, p)));
}

export const isDashTabKey = (v: string | undefined): v is DashTabKey => DASH_TABS.some((t) => t.key === v);

export async function loadDashboard(
  db: Db, actor: Actor, tab: DashTabKey,
  query: { preset?: TimePreset | undefined; start?: string | undefined; end?: string | undefined; bankAccount?: string; accountingSection?: string }, now: Date,
): Promise<Dashboard> {
  const range = dashRange(query.preset ?? (tab === "accounting" ? "today" : undefined), { start: query.start, end: query.end }, now);
  switch (tab) {
    case "sales": return loadSales(db, actor, range);
    case "delivery": return loadDelivery(db, actor, range, now);
    case "purchase": return loadPurchase(db, actor, range);
    case "inventory": return loadInventory(db, actor, range);
    case "returns": return loadReturns(db, actor, range);
    case "production": return loadProduction(db, actor, range);
    case "accounting": return loadAccounting(db, actor, range, query.bankAccount, query.accountingSection ? resolveAccountingSection(actor.perms, query.accountingSection)?.key : undefined);
  }
}
