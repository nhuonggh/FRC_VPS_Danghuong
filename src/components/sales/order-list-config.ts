import type { ListParams } from "@/lib/query-params";

export const ORDER_TABS = [
  { key: "all", label: "Tất cả", filters: {} },
  { key: "pending", label: "Chưa đủ tồn", filters: { pending: ["1"] } },
  { key: "late", label: "Trễ giao", filters: { late: ["1"] } },
  { key: "delivered", label: "Đã giao", filters: { delivery: ["DELIVERED"] } },
  { key: "failed", label: "Không giao được", filters: { delivery: ["FAILED"] } },
  { key: "unpaid", label: "Chưa thanh toán", filters: { payment: ["UNPAID"] } },
] as const;
export type OrderTabKey = (typeof ORDER_TABS)[number]["key"];
export const resetOrderStatusFilters = { pending: [], late: [], delivery: [], payment: [] };
export function activeOrderTab(params: ListParams): OrderTabKey | null {
  const f = params.filters;
  return ORDER_TABS.find((tab) => {
    const expected = tab.filters as Record<string, readonly string[]>;
    return ["pending", "late", "delivery", "payment"].every((key) => (f[key] ?? []).join(",") === (expected[key] ?? []).join(","));
  })?.key ?? null;
}
