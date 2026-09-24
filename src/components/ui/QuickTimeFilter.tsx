"use client";

import { CalendarRange } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate } from "@/lib/format";
import { buildListHref, listTimeRange, type ListParams } from "@/lib/query-params";
import { parseYmd, TIME_PRESETS, type TimePreset } from "@/lib/time-presets";

/**
 * Chờ bao lâu sau lần đổi ngày cuối cùng mới đẩy URL. Chrome bắn `change` theo từng ô (ngày/tháng/năm, thậm chí từng
 * chữ số của năm: 0002 → 0020 → 0202 → 2026) nên phải debounce — nếu không sẽ có 1 lần điều hướng server mỗi phím.
 */
export const DATE_FILTER_DEBOUNCE_MS = 500;

/**
 * Lọc nhanh theo thời gian (dropdown, đủ 10 mốc — KHÔNG lắp rời). Luôn hiện khoảng ngày bắt đầu–kết thúc để người
 * dùng kiểm soát. `now` chỉ để test; server dùng `listTimeRange(params)` + `timeRangeWhere` cho đúng cột ngày nghiệp vụ.
 *
 * Ô ngày của "Tùy chọn" giữ STATE CỤC BỘ (không điều khiển bằng URL — URL chỉ đổi sau khi server điều hướng xong nên
 * ô sẽ bị React reset giữa các lần gõ). Quy tắc đẩy URL: sau `DATE_FILTER_DEBOUNCE_MS` kể từ lần đổi cuối, chỉ khi
 * (2 ô đều rỗng) hoặc (cả 2 là `yyyy-mm-dd` hợp lệ) và khác giá trị đã đẩy/nhận từ URL. Thiếu 1 ô → không đẩy, chỉ nhắc.
 * Cặp đảo ngược (bắt đầu > kết thúc) vẫn đẩy: `listTimeRange` trả null = không lọc, UI báo rõ. Khi URL đổi từ bên ngoài
 * (Back/Forward, xoá bộ lọc, chọn mốc khác) ô được đồng bộ lại theo URL.
 */
export function QuickTimeFilter({ basePath, params, now }: { basePath: string; params: ListParams; now?: Date }) {
  const router = useRouter();
  const range = useMemo(() => listTimeRange(params, now), [params, now]);
  const isCustom = params.timePreset === "custom";

  const urlStart = params.timeStart ?? "";
  const urlEnd = params.timeEnd ?? "";
  const [start, setStart] = useState(urlStart);
  const [end, setEnd] = useState(urlEnd);
  // Cặp ngày (và mốc) mà bộ lọc này đã đẩy lên URL / nhận từ URL lần gần nhất
  const synced = useRef({ start: urlStart, end: urlEnd, preset: params.timePreset });

  // URL đổi từ bên ngoài → ô nhận giá trị URL. Không ghi đè khi URL chỉ là "vọng lại" lần đẩy của chính mình
  // (người dùng có thể đã gõ tiếp trong lúc điều hướng còn treo).
  useEffect(() => {
    const s = synced.current;
    if (s.start !== urlStart || s.end !== urlEnd || s.preset !== params.timePreset) {
      synced.current = { start: urlStart, end: urlEnd, preset: params.timePreset };
      setStart(urlStart);
      setEnd(urlEnd);
    }
  }, [urlStart, urlEnd, params.timePreset]);

  useEffect(() => {
    if (!isCustom) return;
    const bothEmpty = start === "" && end === "";
    const bothValid = parseYmd(start) !== null && parseYmd(end) !== null;
    if (!bothEmpty && !bothValid) return; // chưa đủ cặp → chưa đẩy
    if (start === synced.current.start && end === synced.current.end) return; // không đổi so với URL
    const id = setTimeout(() => {
      synced.current = { ...synced.current, start, end };
      router.push(buildListHref(basePath, params, { timeStart: start || undefined, timeEnd: end || undefined }));
    }, DATE_FILTER_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [isCustom, start, end, basePath, params, router]);

  const incomplete = isCustom && (start === "") !== (end === "");
  const inputCls = "h-10 rounded-sm border border-border bg-canvas px-2";

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
            router.push(buildListHref(basePath, params, { timePreset: v || undefined, timeStart: undefined, timeEnd: undefined }));
          }}
          className="bg-transparent outline-none"
        >
          <option value="">Mọi thời gian</option>
          {TIME_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      {isCustom && (
        <div className="flex items-center gap-1 text-sm">
          <input type="date" aria-label="Từ ngày" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
          <span aria-hidden>–</span>
          <input type="date" aria-label="Đến ngày" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
        </div>
      )}
      {range && (
        <span className="tabular text-xs text-fg-secondary" data-testid="time-range">
          {formatDate(range.start)} – {formatDate(new Date(range.end.getTime() - 1))}
        </span>
      )}
      {isCustom && (!range || incomplete) && (
        <span role="status" className="text-xs text-warning">
          {range
            ? "Chọn đủ 2 ngày để đổi khoảng lọc — đang áp dụng khoảng hiện tại"
            : urlStart && urlEnd
              ? "Ngày bắt đầu không sau ngày kết thúc — đang hiển thị mọi thời gian"
              : "Chọn đủ 2 ngày để lọc — đang hiển thị mọi thời gian"}
        </span>
      )}
    </div>
  );
}
