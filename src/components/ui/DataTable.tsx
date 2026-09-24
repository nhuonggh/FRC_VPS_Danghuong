"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import clsx from "clsx";
import { ArrowDown, ArrowUp, Check, Columns3, Eye, Lock, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NULL_TEXT } from "@/lib/format";
import { nextSort } from "@/lib/pagination";

export interface Column<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  sortable?: boolean;
  width?: number;
  hiddenByDefault?: boolean;
  /** Ô chính trên card mobile (tiêu đề card). */
  primaryOnMobile?: boolean;
  render: (row: T) => React.ReactNode;
}

export interface RowAction {
  key: string;
  label: string;
  icon: "eye" | "pencil" | "trash" | "lock";
  href?: string;
  onClick?: () => void;
  danger?: boolean;
}

const ACTION_ICONS = { eye: Eye, pencil: Pencil, trash: Trash2, lock: Lock };
const MAX_INLINE_ACTIONS = 3;

interface Props<T> {
  /** Khoá lưu cột ẩn/độ rộng vào localStorage. */
  id: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  rowHref?: (row: T) => string;
  rowActions?: (row: T) => RowAction[];
  /** Cột sort hiện tại ('-name' = giảm dần). */
  sort?: string;
  buildSortHref?: (sort: string | undefined) => string;
}

function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setValue(JSON.parse(raw) as T);
    } catch { /* bỏ qua */ }
  }, [key]);
  return [value, (v) => { setValue(v); try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* bỏ qua */ } }];
}

/** Ô rỗng (null/undefined/false/"") → "—", không bao giờ để trống hay hiện 0 thay cho "chưa có". */
const isEmptyNode = (n: React.ReactNode) => n === null || n === undefined || n === false || n === "";

export function DataTable<T>({ id, columns, rows, rowKey, rowHref, rowActions, sort, buildSortHref }: Props<T>) {
  const router = useRouter();
  const [hidden, setHidden] = useStored<Record<string, boolean>>(`table:${id}:hidden`,
    Object.fromEntries(columns.filter((c) => c.hiddenByDefault).map((c) => [c.key, true])));
  const [widths, setWidths] = useStored<Record<string, number>>(`table:${id}:widths`, {});
  const visible = columns.filter((c) => !hidden[c.key]);
  const primary = columns.find((c) => c.primaryOnMobile) ?? columns[0]!;

  const cell = (c: Column<T>, row: T) => {
    const node = c.render(row);
    return isEmptyNode(node) ? <span className="text-fg-muted">{NULL_TEXT}</span> : node;
  };

  function startResize(key: string, e: React.PointerEvent) {
    const startX = e.clientX;
    const th = (e.currentTarget as HTMLElement).closest("th")!;
    const startW = th.getBoundingClientRect().width;
    const move = (ev: PointerEvent) => setWidths({ ...widths, [key]: Math.max(64, Math.round(startW + ev.clientX - startX)) });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const actionsCell = (row: T) => {
    const actions = rowActions?.(row) ?? [];
    if (actions.length === 0) return null;
    const inline = actions.length > MAX_INLINE_ACTIONS ? actions.slice(0, MAX_INLINE_ACTIONS) : actions;
    const rest = actions.length > MAX_INLINE_ACTIONS ? actions.slice(MAX_INLINE_ACTIONS) : [];
    const iconBtn = "flex h-8 w-8 items-center justify-center rounded-sm text-fg-secondary hover:bg-hover";
    return (
      <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        {inline.map((a) => {
          const Ic = ACTION_ICONS[a.icon];
          const cls = clsx(iconBtn, a.danger && "text-danger");
          return a.href ? (
            <Link key={a.key} href={a.href} aria-label={a.label} title={a.label} className={cls}><Ic size={16} aria-hidden /></Link>
          ) : (
            <button key={a.key} type="button" aria-label={a.label} title={a.label} onClick={a.onClick} className={cls}><Ic size={16} aria-hidden /></button>
          );
        })}
        {rest.length > 0 && (
          <Dropdown.Root>
            <Dropdown.Trigger aria-label="Thêm thao tác" className={iconBtn}><MoreHorizontal size={16} aria-hidden /></Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Content align="end" className="z-dropdown min-w-40 rounded-md border border-border bg-raised p-1 shadow-md">
                {rest.map((a) => (
                  <Dropdown.Item key={a.key} onSelect={() => (a.href ? router.push(a.href) : a.onClick?.())}
                    className={clsx("flex h-9 cursor-pointer items-center rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-hover", a.danger && "text-danger")}>
                    {a.label}
                  </Dropdown.Item>
                ))}
              </Dropdown.Content>
            </Dropdown.Portal>
          </Dropdown.Root>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Điều khiển cột */}
      <div className="flex justify-end border-b border-border px-2 py-1">
        <Dropdown.Root>
          <Dropdown.Trigger aria-label="Cột hiển thị" title="Cột hiển thị" className="flex h-8 w-8 items-center justify-center rounded-sm text-fg-secondary hover:bg-hover">
            <Columns3 size={16} aria-hidden />
          </Dropdown.Trigger>
          <Dropdown.Portal>
            <Dropdown.Content align="end" className="z-dropdown min-w-44 rounded-md border border-border bg-raised p-1 shadow-md">
              {columns.map((c) => (
                <Dropdown.CheckboxItem key={c.key} checked={!hidden[c.key]} onCheckedChange={(v) => setHidden({ ...hidden, [c.key]: !v })}
                  onSelect={(e) => e.preventDefault()}
                  className="flex h-9 cursor-pointer items-center gap-2 rounded-sm px-3 text-sm outline-none data-[highlighted]:bg-hover">
                  <span aria-hidden className="flex h-4 w-4 items-center justify-center rounded-sm border border-border-strong">{!hidden[c.key] && <Check size={12} />}</span>
                  {c.label}
                </Dropdown.CheckboxItem>
              ))}
            </Dropdown.Content>
          </Dropdown.Portal>
        </Dropdown.Root>
      </div>

      {/* PC/tablet: bảng */}
      <table className="hidden w-full border-collapse text-sm md:table">
        <thead className="sticky top-0 z-header bg-surface">
          <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">
            {visible.map((c) => {
              const dir = sort === c.key ? "ascending" : sort === `-${c.key}` ? "descending" : "none";
              return (
                <th key={c.key} scope="col" aria-sort={c.sortable ? dir : undefined}
                  style={widths[c.key] ? { width: widths[c.key] } : c.width ? { width: c.width } : undefined}
                  className={clsx("relative px-3 py-2", c.align === "right" && "text-right")}>
                  {c.sortable && buildSortHref ? (
                    <Link href={buildSortHref(nextSort(sort, c.key))} className="inline-flex items-center gap-1 hover:text-fg">
                      {c.label}
                      {dir === "ascending" && <ArrowUp size={12} aria-hidden />}
                      {dir === "descending" && <ArrowDown size={12} aria-hidden />}
                    </Link>
                  ) : c.label}
                  <span role="separator" aria-orientation="vertical" onPointerDown={(e) => startResize(c.key, e)}
                    className="absolute right-0 top-1/4 h-1/2 w-1 cursor-col-resize rounded-full hover:bg-accent" />
                </th>
              );
            })}
            {rowActions && <th scope="col" className="w-28 px-3 py-2 text-right">Thao tác</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} onClick={rowHref ? () => router.push(rowHref(row)) : undefined}
              className={clsx("border-b border-border last:border-b-0 hover:bg-hover", rowHref && "cursor-pointer")}>
              {visible.map((c) => (
                <td key={c.key} className={clsx("px-3 py-2", c.align === "right" && "tabular text-right")}>
                  {c === primary && rowHref ? (
                    <Link href={rowHref(row)} onClick={(e) => e.stopPropagation()} className="hover:text-accent">{cell(c, row)}</Link>
                  ) : cell(c, row)}
                </td>
              ))}
              {rowActions && <td className="px-3 py-1">{actionsCell(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: card list (cùng dữ liệu & hành vi, khác hình thức) */}
      <ul className="divide-y divide-[var(--border-default)] md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="flex items-start justify-between gap-2 p-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {rowHref ? <Link href={rowHref(row)}>{cell(primary, row)}</Link> : cell(primary, row)}
              </div>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                {visible.filter((c) => c !== primary).slice(0, 4).map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-fg-muted">{c.label}</dt>
                    <dd className={clsx("truncate", c.align === "right" && "tabular")}>{cell(c, row)}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {rowActions && <div className="shrink-0">{actionsCell(row)}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}
