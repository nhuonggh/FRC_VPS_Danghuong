import type { PermissionCode } from "@/lib/permissions/catalog";
import type { Actor } from "@/lib/permissions/scope";

export const DAILY_ITEMS = [
  { key: "return-order", label: "Trả hàng theo đơn", group: "Trả hàng & kho", perm: "return.manage", moneyPerm: "sale_price.view" },
  { key: "return-product", label: "Trả hàng theo sản phẩm", group: "Trả hàng & kho", perm: "return.manage", moneyPerm: "sale_price.view" },
  { key: "return-supplier", label: "Trả hàng NCC", group: "Trả hàng & kho", perm: "return.manage", moneyPerm: "purchase_price.view" },
  { key: "undelivered", label: "Hàng không giao được trả kho", group: "Trả hàng & kho", perm: "return.manage", moneyPerm: "sale_price.view" },
  { key: "loss", label: "Điều chỉnh hao hụt", group: "Trả hàng & kho", perm: "stock_adjust.manage", moneyPerm: "cost.view" },
  { key: "debt", label: "Điều chỉnh công nợ", group: "Công nợ & chiết khấu", perm: "debt.adjust" },
  { key: "discount-orders", label: "Đơn có chiết khấu", group: "Công nợ & chiết khấu", perm: "order.view", moneyPerm: "sale_price.view" },
  { key: "settlements", label: "Tất toán chiết khấu", group: "Công nợ & chiết khấu", perm: "debt.view" },
  { key: "receipts", label: "Phiếu thu", group: "Thu chi & nhập hàng", perm: "receipt.manage" },
  { key: "payments", label: "Phiếu chi", group: "Thu chi & nhập hàng", perm: "payment.manage" },
  { key: "purchases", label: "Danh sách nhập hàng", group: "Thu chi & nhập hàng", perm: "purchase.view", moneyPerm: "purchase_price.view" },
] as const satisfies readonly { key: string; label: string; group: string; perm: PermissionCode; moneyPerm?: PermissionCode }[];

export type DailyItem = (typeof DAILY_ITEMS)[number];
export type DailyKey = DailyItem["key"];
export const DAILY_FILTER_KEYS = ["state", "type", "method"] as const;
export const visibleDailyItems = (actor: Actor) => DAILY_ITEMS.filter((item) => actor.perms.has(item.perm));
export const dailyCanMoney = (actor: Actor, item: DailyItem) => !("moneyPerm" in item) || actor.perms.has(item.moneyPerm);
