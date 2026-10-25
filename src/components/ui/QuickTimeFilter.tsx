"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { formatDate } from "@/lib/format";
import { buildListHref, listTimeRange, type ListParams } from "@/lib/query-params";
import { ictYmd, toIct } from "@/lib/time";
import { parseYmd, resolveTimeRange, TIME_PRESETS, type TimePreset } from "@/lib/time-presets";

type Selection = Pick<ListParams, "timePreset" | "timeStart" | "timeEnd">;
const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const button = `min-h-11 rounded-sm px-3 text-sm hover:bg-hover ${focus}`;

/** Shared draft editor: calendar and typed dates never navigate before Apply. */
export function TimeRangeEditor({ value, onChange, now, allowAll = true }: {
  value: Selection; onChange: (value: Selection) => void; now?: Date; allowAll?: boolean;
}) {
  const today = toIct(now ?? new Date());
  const range = value.timePreset ? resolveTimeRange(value.timePreset, now ?? new Date(), { start: value.timeStart, end: value.timeEnd }) : null;
  const start = value.timePreset === "custom" ? value.timeStart ?? "" : range ? ictYmd(range.start) : "";
  const end = value.timePreset === "custom" ? value.timeEnd ?? "" : range ? ictYmd(new Date(range.end.getTime() - 1)) : "";
  const initial = parseYmd(start);
  const [month, setMonth] = useState({ y: initial?.y ?? today.y, m: initial?.m ?? today.m });
  const [choosingEnd, setChoosingEnd] = useState(false);
  function choosePreset(preset?: TimePreset) {
    onChange({ timePreset: preset, timeStart: undefined, timeEnd: undefined });
    setChoosingEnd(false);
    const selected = preset && resolveTimeRange(preset, now ?? new Date());
    if (selected) { const t = toIct(selected.start); setMonth({ y: t.y, m: t.m }); }
  }
  function chooseDay(day: string) {
    if (!choosingEnd) { onChange({ timePreset: "custom", timeStart: day, timeEnd: undefined }); setChoosingEnd(true); }
    else { onChange({ timePreset: "custom", timeStart: day < start ? day : start, timeEnd: day < start ? start : day }); setChoosingEnd(false); }
  }
  const offset = (new Date(Date.UTC(month.y, month.m, 1)).getUTCDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(Date.UTC(month.y, month.m, i - offset + 1));
    return { key: d.toISOString().slice(0, 10), day: d.getUTCDate(), outside: d.getUTCMonth() !== month.m };
  });
  function move(delta: number) { const d = new Date(Date.UTC(month.y, month.m + delta, 1)); setMonth({ y: d.getUTCFullYear(), m: d.getUTCMonth() }); }
  return <div className="grid gap-4 md:grid-cols-[10rem_1fr]">
    <div className="flex gap-1 overflow-x-auto md:block md:space-y-1 md:border-r md:border-border md:pr-3">
      <p className="mb-2 hidden px-3 text-xs font-semibold text-fg-secondary md:block">CHỌN NHANH</p>
      {[...(allowAll ? [{ value: "all" as TimePreset | undefined, label: "Mọi thời gian" }] : []), ...TIME_PRESETS].map((p) => <button type="button" key={p.value ?? "all"} aria-pressed={value.timePreset === p.value} onClick={() => choosePreset(p.value)} className={`${button} shrink-0 text-left md:w-full ${value.timePreset === p.value ? "bg-accent-soft font-medium text-accent" : "text-fg-secondary"}`}>{p.label}</button>)}
    </div>
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between"><h3 aria-live="polite" className="text-sm font-semibold">Tháng {month.m + 1}, {month.y}</h3><div className="flex"><button type="button" aria-label="Tháng trước" onClick={() => move(-1)} className={button}><ChevronLeft size={16} /></button><button type="button" aria-label="Tháng sau" onClick={() => move(1)} className={button}><ChevronRight size={16} /></button></div></div>
      <div className="grid grid-cols-7 text-center text-sm" role="group" aria-label="Lịch chọn khoảng ngày">
        {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((d) => <span key={d} className="py-2 text-xs font-medium text-fg-secondary">{d}</span>)}
        {days.map((d) => <button type="button" key={d.key} aria-label={d.key.split("-").reverse().join("/")} aria-pressed={d.key === start || d.key === end} onClick={() => chooseDay(d.key)} className={`min-h-11 rounded-sm text-sm tabular-nums ${focus} ${d.key === start || d.key === end ? "bg-accent font-medium text-fg-on-accent" : start && end && d.key > start && d.key < end ? "bg-accent-soft text-accent" : d.outside ? "text-fg-secondary hover:bg-hover" : "hover:bg-hover"}`}>{d.day}</button>)}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">{[{ label: "Từ ngày", value: start, key: "timeStart" }, { label: "Đến ngày", value: end, key: "timeEnd" }].map((field) => <label key={field.key} className="grid gap-1 text-xs text-fg-secondary">{field.label}<input type="date" value={field.value} onChange={(e) => { setChoosingEnd(false); onChange({ timePreset: "custom", timeStart: start, timeEnd: end, [field.key]: e.target.value }); }} className={`min-h-11 min-w-0 w-full rounded-sm border border-border bg-canvas px-2 text-sm text-fg ${focus}`} /></label>)}</div>
      <p aria-live="polite" className="mt-2 text-xs text-fg-secondary">{choosingEnd ? "Chọn ngày kết thúc trên lịch." : "Chọn ngày bắt đầu và ngày kết thúc trên lịch."}</p>
    </div>
  </div>;
}

export function QuickTimeFilter({ basePath, params, now, allowAll = true, onChange }: { basePath: string; params: ListParams; now?: Date; allowAll?: boolean; onChange?: (value: Selection) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [pending, transition] = useTransition();
  const [draft, setDraft] = useState<Selection>(params);
  useEffect(() => { const media = window.matchMedia?.("(max-width: 767px)"); if (!media) return; const update = () => setMobile(media.matches); update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  function toggle(next: boolean) { if (next) setDraft({ timePreset: params.timePreset ?? (allowAll ? "all" : "today"), timeStart: params.timeStart, timeEnd: params.timeEnd }); setOpen(next); }
  const range = listTimeRange(params, now);
  const draftRange = draft.timePreset ? resolveTimeRange(draft.timePreset, now ?? new Date(), { start: draft.timeStart, end: draft.timeEnd }) : null;
  const invalid = !!draft.timePreset && draft.timePreset !== "all" && !draftRange;
  const label = TIME_PRESETS.find((p) => p.value === params.timePreset)?.label ?? (allowAll ? "Mọi thời gian" : "Hôm nay");
  const trigger = <button type="button" aria-label="Lọc nhanh theo thời gian" className={`flex min-h-11 items-center gap-2 rounded-sm border border-border bg-canvas px-3 text-sm hover:bg-hover md:min-h-10 ${focus}`}><CalendarRange size={16} aria-hidden className="text-accent" />{label}<ChevronDown size={14} aria-hidden /></button>;
  const body = <><TimeRangeEditor value={draft} onChange={setDraft} now={now} allowAll={allowAll} />
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
      <p aria-live="polite" className={`text-xs ${invalid ? "text-danger" : "text-fg-secondary"}`}>{invalid ? "Chọn đủ 2 ngày hợp lệ; ngày bắt đầu không sau ngày kết thúc." : draftRange ? `${formatDate(draftRange.start)} – ${formatDate(new Date(draftRange.end.getTime() - 1))}` : "Mọi thời gian (không lọc theo ngày)"}</p>
      <button type="button" disabled={invalid || pending} onClick={() => { const next = { timePreset: draft.timePreset, timeStart: draft.timePreset === "custom" ? draft.timeStart : undefined, timeEnd: draft.timePreset === "custom" ? draft.timeEnd : undefined }; if (onChange) onChange(next); else transition(() => router.push(buildListHref(basePath, params, next))); setOpen(false); }} className={`min-h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-50 ${focus}`}>Áp dụng</button>
    </div></>;
  return <div className="flex flex-wrap items-center gap-2">
    {mobile ? <Dialog.Root open={open} onOpenChange={toggle}><Dialog.Trigger asChild>{trigger}</Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" /><Dialog.Content className="fixed inset-x-0 bottom-0 z-dialog max-h-[90dvh] overflow-auto rounded-t-lg border border-border bg-raised p-4"><div className="mb-3 flex items-center justify-between"><Dialog.Title className="text-lg font-semibold">Khoảng thời gian</Dialog.Title><Dialog.Close aria-label="Đóng bộ lọc ngày" className={button}><X size={20} /></Dialog.Close></div><Dialog.Description className="sr-only">Chọn mốc nhanh hoặc khoảng ngày rồi bấm Áp dụng.</Dialog.Description>{body}</Dialog.Content></Dialog.Portal></Dialog.Root>
    : <Dropdown.Root open={open} onOpenChange={toggle} modal={false}><Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger><Dropdown.Portal><Dropdown.Content align="start" sideOffset={8} collisionPadding={16} onKeyDownCapture={(e) => { if (e.key !== "Escape") e.stopPropagation(); }} className="z-dialog max-h-[var(--radix-dropdown-menu-content-available-height)] w-[36rem] max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border border-border bg-raised p-4 shadow-lg"><div role="group" aria-label="Chọn khoảng thời gian">{body}</div></Dropdown.Content></Dropdown.Portal></Dropdown.Root>}
    {range && <span className="tabular text-xs text-fg-secondary" data-testid="time-range">{formatDate(range.start)} – {formatDate(new Date(range.end.getTime() - 1))}</span>}
  </div>;
}
