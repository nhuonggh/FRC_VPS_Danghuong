"use client";

import { useRouter } from "next/navigation";
import { buildListHref, type ListParams } from "@/lib/query-params";

const field = "h-11 rounded-sm border border-border bg-surface px-2 text-sm md:h-10";

/** Lọc theo khoảng Ngày giao dự kiến (từ/đến, bỏ trống một đầu = không giới hạn đầu đó). */
export function DeliveryDateFilter({ basePath, params }: { basePath: string; params: ListParams }) {
  const router = useRouter();
  const set = (key: "deliveryFrom" | "deliveryTo") => (e: React.ChangeEvent<HTMLInputElement>) =>
    router.push(buildListHref(basePath, params, { filters: { [key]: e.target.value ? [e.target.value] : [] } }));
  return (
    <div className="flex items-center gap-2 text-sm text-fg-secondary">
      <span>Ngày giao</span>
      <input type="date" aria-label="Ngày giao dự kiến từ" value={params.filters.deliveryFrom?.[0] ?? ""} max={params.filters.deliveryTo?.[0]} onChange={set("deliveryFrom")} className={field} />
      <span>–</span>
      <input type="date" aria-label="Ngày giao dự kiến đến" value={params.filters.deliveryTo?.[0] ?? ""} min={params.filters.deliveryFrom?.[0]} onChange={set("deliveryTo")} className={field} />
    </div>
  );
}
