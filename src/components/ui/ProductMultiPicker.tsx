"use client";

import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { ListPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ComboOption } from "./Combobox";

/** Tối thiểu một sản phẩm cần có để hiện trong danh sách chọn (ProductOption, MaterialOption… đều thoả). */
export type PickerOption = ComboOption & { value: number };

interface Props<T extends PickerOption> {
  /** Tìm sản phẩm phía server (q rỗng = gợi ý mặc định). */
  load: (q: string) => Promise<T[]>;
  /** Trả các sản phẩm đã tick (theo thứ tự tick). Dialog đóng sau khi gọi. */
  onPicked: (products: T[]) => void;
  /** Mã đã có trong đơn: hiện dấu "Đã có" (vẫn chọn được). */
  existingIds?: readonly number[];
  disabled?: boolean;
  buttonLabel?: string;
}

/** Chọn nhiều sản phẩm một lần: tìm → tick nhiều dòng (giữ tick khi đổi từ khoá) → "Thêm N sản phẩm". */
export function ProductMultiPicker<T extends PickerOption>({ load, onPicked, existingIds = [], disabled, buttonLabel = "Chọn nhiều sản phẩm" }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<T[]>([]);
  const [picked, setPicked] = useState<Map<number, T>>(new Map());
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const req = useRef(0);

  useEffect(() => {
    if (!open) return;
    const id = ++req.current;
    setLoading(true); setFailed(false);
    const t = setTimeout(async () => {
      try { const res = await load(q); if (id === req.current) setRows(res); }
      catch { if (id === req.current) { setRows([]); setFailed(true); } }
      finally { if (id === req.current) setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { setOpen(false); setQ(""); setPicked(new Map()); setRows([]); };
  const toggle = (p: T) => setPicked((m) => { const n = new Map(m); if (n.has(p.value)) n.delete(p.value); else n.set(p.value, p); return n; });
  const confirm = () => { const list = [...picked.values()]; close(); if (list.length) onPicked(list); };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <button type="button" disabled={disabled} onClick={() => setOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover disabled:opacity-40 md:h-10">
        <ListPlus size={16} aria-hidden /> {buttonLabel}
      </button>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog flex max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-raised p-5 shadow-lg">
          <Dialog.Title className="text-base font-semibold">Chọn nhiều sản phẩm</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-fg-secondary">Tick các sản phẩm cần thêm; có thể đổi từ khoá tìm mà vẫn giữ các mục đã tick.</Dialog.Description>
          <input autoFocus aria-label="Tìm sản phẩm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã, tên…" className="mt-3 h-10 w-full rounded-sm border border-border bg-canvas px-3 text-sm" />
          <ul role="listbox" aria-multiselectable aria-label="Kết quả tìm sản phẩm" className="mt-3 min-h-40 flex-1 overflow-auto rounded-sm border border-border">
            {rows.map((p) => {
              const on = picked.has(p.value);
              return (
                <li key={p.value} role="option" aria-selected={on}>
                  <label className={clsx("flex min-h-11 cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-hover", on && "bg-accent-soft")}>
                    <input type="checkbox" checked={on} onChange={() => toggle(p)} className="h-4 w-4" aria-label={p.label} />
                    <span className="min-w-0 flex-1 truncate">{p.label}</span>
                    {existingIds.includes(p.value) && <span className="shrink-0 text-xs text-warning">Đã có</span>}
                    <span className="shrink-0 text-xs text-fg-muted">{p.hint}</span>
                  </label>
                </li>
              );
            })}
            {!loading && failed && <li className="px-3 py-3 text-sm text-danger">Không tải được danh sách</li>}
            {!loading && !failed && rows.length === 0 && <li className="px-3 py-3 text-sm text-fg-muted">Không tìm thấy kết quả</li>}
            {loading && rows.length === 0 && <li className="px-3 py-3 text-sm text-fg-muted">Đang tìm…</li>}
          </ul>
          <div className="mt-4 flex items-center justify-between gap-2">
            <span className="text-sm text-fg-secondary">Đã chọn: {picked.size}</span>
            <div className="flex gap-2">
              <button type="button" onClick={close} className="h-11 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover md:h-10">Đóng</button>
              <button type="button" onClick={confirm} disabled={picked.size === 0} className="h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-60 md:h-10">
                {picked.size ? `Thêm ${picked.size} sản phẩm` : "Thêm"}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Đưa các sản phẩm đã chọn vào danh sách dòng: điền vào dòng trống trước (chưa có sản phẩm), hết thì thêm dòng mới.
 * `make` dựng giá trị dòng từ ProductOption; `max` chặn quá số dòng tối đa của form. Trả về số dòng đã thêm.
 */
export function addPickedLines<T, L>(
  picked: readonly T[],
  current: readonly ({ productId?: number } | undefined)[],
  make: (p: T) => L,
  ops: { update: (index: number, value: L) => void; append: (values: L[]) => void },
  max = Number.POSITIVE_INFINITY,
): number {
  const blanks = current.map((l, i) => (l?.productId ? -1 : i)).filter((i) => i >= 0);
  let used = 0, added = 0;
  const extra: L[] = [];
  for (const p of picked) {
    if (used < blanks.length) { ops.update(blanks[used++]!, make(p)); added++; continue; }
    if (current.length + extra.length >= max) break;
    extra.push(make(p)); added++;
  }
  if (extra.length) ops.append(extra);
  return added;
}
