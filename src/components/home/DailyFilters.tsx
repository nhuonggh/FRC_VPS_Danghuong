"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { buildListHref, type ListParams } from "@/lib/query-params";
import { resolveTimeRange, TIME_PRESETS } from "@/lib/time-presets";
import { MultiSelectFilter, QuickTimeFilter } from "@/components/ui";
import { TimeRangeEditor } from "@/components/ui/QuickTimeFilter";

const STATES = [{ value: "active", label: "Hiệu lực" }, { value: "cancelled", label: "Đã hủy" }];
const TYPES = [{ value: "LOSS", label: "Hao hụt" }, { value: "WRITE_OFF", label: "Xuất hủy" }];
const METHODS = [{ value: "CASH", label: "Chi tiền" }, { value: "OFFSET", label: "Trừ công nợ" }];

/** PC applies inline filters; mobile stages the same filters in an accessible bottom sheet. */
export function DailyFilters({ basePath, params, itemKey, now }: { basePath: string; params: ListParams; itemKey?: string; now: Date }) {
  const router = useRouter();
  const [open, setOpen] = useState(false), [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(params), [error, setError] = useState("");
  function toggle(key: string, value: string, fallback: string[]) {
    const values = draft.filters[key] ?? fallback;
    setDraft({ ...draft, filters: { ...draft.filters, [key]: values.includes(value) ? values.filter((v) => v !== value) : [...values, value] } });
  }
  const groups = itemKey ? [{ key: "state", label: "Trạng thái", options: STATES, fallback: ["active"] },
    ...(itemKey === "loss" ? [{ key: "type", label: "Loại", options: TYPES, fallback: ["LOSS"] }] : []),
    ...(itemKey === "settlements" ? [{ key: "method", label: "Hình thức", options: METHODS, fallback: [] as string[] }] : []),
  ] : [];
  function apply() {
    const preset = draft.timePreset ?? "today";
    if (!resolveTimeRange(preset, now, { start: draft.timeStart, end: draft.timeEnd })) { setError("Chọn đủ khoảng ngày hợp lệ."); return; }
    if (groups.some((g) => g.key !== "method" && draft.filters[g.key]?.length === 0)) { setError("Chọn ít nhất một trạng thái và loại chứng từ."); return; }
    startTransition(() => router.push(buildListHref(basePath, params, { timePreset: preset, timeStart: preset === "custom" ? draft.timeStart : undefined, timeEnd: preset === "custom" ? draft.timeEnd : undefined, filters: draft.filters })));
    setOpen(false);
  }
  return <>
    <div className="hidden flex-wrap items-center gap-2 md:flex"><QuickTimeFilter basePath={basePath} params={params} allowAll={false} now={now} />
      {itemKey && <MultiSelectFilter label="Trạng thái" paramKey="state" basePath={basePath} params={params} options={STATES} />}
      {itemKey === "loss" && <MultiSelectFilter label="Loại" paramKey="type" basePath={basePath} params={params} options={TYPES} />}
      {itemKey === "settlements" && <MultiSelectFilter label="Hình thức" paramKey="method" basePath={basePath} params={params} options={METHODS} />}
    </div>
    <Dialog.Root open={open} onOpenChange={(value) => { if (value) { setDraft(params); setError(""); } setOpen(value); }}>
      <Dialog.Trigger className="inline-flex min-h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:hidden"><SlidersHorizontal size={16} aria-hidden />Bộ lọc · {TIME_PRESETS.find((p) => p.value === params.timePreset)?.label ?? "Hôm nay"}</Dialog.Trigger>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" /><Dialog.Content className="fixed inset-x-0 bottom-0 z-dialog max-h-[85dvh] overflow-y-auto rounded-t-lg border border-border bg-raised p-4">
        <div className="flex items-center justify-between"><Dialog.Title className="text-lg font-semibold">Lọc báo cáo</Dialog.Title><Dialog.Close aria-label="Đóng bộ lọc" className="flex h-11 w-11 items-center justify-center rounded-sm hover:bg-hover"><X size={20} aria-hidden /></Dialog.Close></div>
        <Dialog.Description className="mb-3 text-sm text-fg-secondary">Chọn khoảng ngày và điều kiện, sau đó bấm Áp dụng.</Dialog.Description>
        <TimeRangeEditor value={draft} now={now} allowAll={false} onChange={(value) => setDraft({ ...draft, ...value })} />
        {groups.map((g) => <fieldset key={g.key} className="mt-4"><legend className="text-sm font-medium">{g.label}</legend><div className="flex flex-wrap gap-3">{g.options.map((o) => <label key={o.value} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={(draft.filters[g.key] ?? g.fallback).includes(o.value)} onChange={() => toggle(g.key, o.value, g.fallback)} />{o.label}</label>)}</div></fieldset>)}
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <button type="button" onClick={apply} disabled={pending} className="mt-4 min-h-11 w-full rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-50">Áp dụng</button>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </>;
}
