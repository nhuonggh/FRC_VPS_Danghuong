import { ictStartOfDay, ictYmd, toIct } from "@/lib/time";
import { TIME_PRESETS } from "@/lib/time-presets";
import type { ListParams, ListPatch } from "@/lib/query-params";

export const DEPOSIT_STATES = [
  { key: "all", label: "Tất cả phiếu", tone: "accent" },
  { key: "attached", label: "Gắn đơn", tone: "success" },
  { key: "released", label: "Số dư khách", tone: "info" },
  { key: "cancelled", label: "Đã hủy", tone: "danger" },
] as const;
export type DepositState = typeof DEPOSIT_STATES[number]["key"];
export function depositTimeOptions(now: Date) {
  const today = toIct(now);
  const yesterday = ictYmd(ictStartOfDay(today.y, today.m, today.d - 1));
  return [
    { key: "all", label: "Tất cả", patch: { timePreset: "all", timeStart: undefined, timeEnd: undefined } as ListPatch },
    { key: "today", label: "Hôm nay", patch: { timePreset: "today", timeStart: undefined, timeEnd: undefined } as ListPatch },
    { key: "yesterday", label: "Hôm qua", patch: { timePreset: "custom", timeStart: yesterday, timeEnd: yesterday } as ListPatch },
    ...TIME_PRESETS.filter((p) => p.value !== "today" && p.value !== "custom").map((p) => ({ key: p.value, label: p.label, patch: { timePreset: p.value, timeStart: undefined, timeEnd: undefined } as ListPatch })),
  ];
}
export function activeDepositTime(params: ListParams, now: Date) {
  if (!params.timePreset || params.timePreset === "all") return "all";
  const yesterday = depositTimeOptions(now).find((p) => p.key === "yesterday")!.patch;
  if (params.timePreset === "custom" && params.timeStart === yesterday.timeStart && params.timeEnd === yesterday.timeEnd) return "yesterday";
  return params.timePreset;
}
