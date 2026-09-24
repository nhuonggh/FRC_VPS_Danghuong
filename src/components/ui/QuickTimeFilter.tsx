"use client";

import { CalendarRange } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { formatDate } from "@/lib/format";
import { buildListHref, listTimeRange, type ListParams, type ListPatch } from "@/lib/query-params";
import { TIME_PRESETS, type TimePreset } from "@/lib/time-presets";

/**
 * Lọc nhanh theo thời gian (dropdown, đủ 10 mốc — KHÔNG lắp rời). Luôn hiện khoảng ngày bắt đầu–kết thúc để người
 * dùng kiểm soát. `now` chỉ để test; server dùng `listTimeRange(params)` + `timeRangeWhere` cho đúng cột ngày nghiệp vụ.
 */
export function QuickTimeFilter({ basePath, params, now }: { basePath: string; params: ListParams; now?: Date }) {
  const router = useRouter();
  const range = useMemo(() => listTimeRange(params, now), [params, now]);
  const go = (patch: ListPatch) => router.push(buildListHref(basePath, params, patch));
  const isCustom = params.timePreset === "custom";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex h-10 items-center gap-2 rounded-sm border border-border bg-canvas px-3 text-sm">
        <CalendarRange size={16} aria-hidden className="text-fg-muted" />
        <select
          aria-label="Lọc nhanh theo thời gian"
          value={params.timePreset ?? ""}
          onChange={(e) => {
            const v = e.target.value as TimePreset | "";
            // đổi mốc luôn xoá 2 ngày tuỳ chọn cũ (chỉ 'Tùy chọn' mới dùng chúng)
            go({ timePreset: v || undefined, timeStart: undefined, timeEnd: undefined });
          }}
          className="bg-transparent outline-none"
        >
          <option value="">Mọi thời gian</option>
          {TIME_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      {isCustom && (
        <div className="flex items-center gap-1 text-sm">
          <input type="date" aria-label="Từ ngày" value={params.timeStart ?? ""} onChange={(e) => go({ timeStart: e.target.value || undefined })} className="h-10 rounded-sm border border-border bg-canvas px-2" />
          <span aria-hidden>–</span>
          <input type="date" aria-label="Đến ngày" value={params.timeEnd ?? ""} onChange={(e) => go({ timeEnd: e.target.value || undefined })} className="h-10 rounded-sm border border-border bg-canvas px-2" />
        </div>
      )}
      {range && (
        <span className="tabular text-xs text-fg-secondary" data-testid="time-range">
          {formatDate(range.start)} – {formatDate(new Date(range.end.getTime() - 1))}
        </span>
      )}
      {isCustom && !range && (
        <span role="status" className="text-xs text-warning">
          {params.timeStart && params.timeEnd
            ? "Ngày bắt đầu không sau ngày kết thúc — đang hiển thị mọi thời gian"
            : "Chọn đủ 2 ngày để lọc — đang hiển thị mọi thời gian"}
        </span>
      )}
    </div>
  );
}
