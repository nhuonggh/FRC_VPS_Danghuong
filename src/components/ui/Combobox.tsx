"use client";

import clsx from "clsx";
import { ChevronDown, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { normalizeSearch } from "@/lib/search";

export interface ComboOption {
  value: string | number;
  label: string;
  hint?: string;
}

/**
 * Lọc danh sách TĨNH (đã có sẵn ở client) theo cùng chuẩn tìm không dấu của server (`normalizeSearch`):
 * mỗi từ khoá phải có mặt trong nhãn hoặc gợi ý. Với danh sách lớn/FK thì `loadOptions` gọi server
 * (`searchTextWhere`) — không dùng hàm này để lọc cả bảng ở client.
 */
export function filterComboOptions(options: ComboOption[], q: string): ComboOption[] {
  const terms = normalizeSearch(q).split(" ").filter(Boolean);
  if (terms.length === 0) return options;
  return options.filter((o) => {
    const hay = normalizeSearch(`${o.label} ${o.hint ?? ""}`);
    return terms.every((t) => hay.includes(t));
  });
}

interface Props {
  label: string;
  value: ComboOption | null;
  onChange: (o: ComboOption | null) => void;
  /** Gọi phía server/DB, không lọc ở client. q rỗng = gợi ý mặc định. */
  loadOptions: (q: string) => Promise<ComboOption[]>;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  debounceMs?: number;
}

const BLUR_CLOSE_MS = 120; // chờ để click vào 1 dòng kịp chạy trước khi đóng danh sách

export function Combobox({ label, value, onChange, loadOptions, placeholder = "Tìm…", disabled, error, debounceMs = 300 }: Props) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [q, setQ] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ComboOption[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const req = useRef(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => setQ(value?.label ?? ""), [value]);
  useEffect(() => () => clearTimeout(blurTimer.current), []);

  useEffect(() => {
    if (!open) return;
    const id = ++req.current; // bỏ kết quả của lần gõ cũ
    setLoading(true);
    setFailed(false);
    const t = setTimeout(async () => {
      try {
        const res = await loadOptions(q === value?.label ? "" : q);
        if (id === req.current) {
          setOptions(res);
          // mở lại khi đã chọn → đặt dòng active vào đúng lựa chọn hiện tại
          const at = res.findIndex((o) => o.value === value?.value);
          setActive(at >= 0 ? at : 0);
        }
      } catch {
        if (id === req.current) { setOptions([]); setFailed(true); }
      } finally {
        if (id === req.current) setLoading(false);
      }
    }, debounceMs);
    return () => clearTimeout(t);
  }, [q, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (o: ComboOption) => { onChange(o); setQ(o.label); setOpen(false); };

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && open && options[active]) { e.preventDefault(); pick(options[active]!); }
    else if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); setQ(value?.label ?? ""); }
  }

  return (
    <div className="relative">
      <label htmlFor={uid} className="mb-1 block text-xs text-fg-muted">{label}</label>
      <div className="relative">
        <input
          id={uid} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${uid}-o${active}` : undefined}
          aria-invalid={!!error} disabled={disabled} value={q} placeholder={placeholder} autoComplete="off"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => { clearTimeout(blurTimer.current); setOpen(true); }}
          onBlur={() => {
            clearTimeout(blurTimer.current);
            blurTimer.current = setTimeout(() => { setOpen(false); setQ(value?.label ?? ""); }, BLUR_CLOSE_MS);
          }}
          onKeyDown={onKeyDown}
          className={clsx("h-9 w-full rounded-sm border bg-canvas pl-3 pr-14 text-sm hover:border-border-strong disabled:opacity-60", error ? "border-danger" : "border-border")}
        />
        <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
          {value && !disabled && (
            <button type="button" aria-label="Xóa lựa chọn" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(null); setQ(""); }} className="flex h-7 w-7 items-center justify-center text-fg-muted hover:text-fg">
              <X size={14} aria-hidden />
            </button>
          )}
          <ChevronDown size={16} aria-hidden className="mr-2 text-fg-muted" />
        </div>
      </div>
      {open && (
        <ul id={listId} role="listbox" aria-label={label} className="absolute z-dropdown mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-raised p-1 shadow-md">
          {options.map((o, i) => (
            <li key={o.value} id={`${uid}-o${i}`} role="option" aria-selected={value?.value === o.value}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)} onMouseEnter={() => setActive(i)}
              className={clsx("flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-sm px-3 py-2 text-sm md:min-h-9", i === active && "bg-hover")}>
              <span className="truncate">{o.label}</span>
              {o.hint && <span className="shrink-0 text-xs text-fg-muted">{o.hint}</span>}
            </li>
          ))}
          {!loading && failed && <li className="px-3 py-2 text-sm text-danger">Không tải được danh sách</li>}
          {!loading && !failed && options.length === 0 && <li className="px-3 py-2 text-sm text-fg-muted">Không tìm thấy kết quả</li>}
          {loading && options.length === 0 && <li className="px-3 py-2 text-sm text-fg-muted">Đang tìm…</li>}
        </ul>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
