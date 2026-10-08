import clsx from "clsx";
import type { ReactNode } from "react";

/** Ô nhập trong khung ghép của InlineField: không viền riêng, chiều cao 44px mobile / 36px desktop. */
export const igInput = "h-11 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none read-only:text-fg-secondary disabled:opacity-60 md:h-9";
/** Bọc Combobox/chọn có viền riêng để nó hòa vào khung ghép của InlineField (bỏ viền + bo góc của chính nó). */
export const igCombo = "min-w-0 flex-1 [&_input]:h-11 [&_input]:rounded-none [&_input]:border-0 [&_input]:bg-transparent [&_input]:outline-none md:[&_input]:h-9";

/**
 * Ô nhập kiểu form lập đơn cũ: nhãn nền xám ở bên trái, ô nhập bên phải, chung một khung viền.
 * Mobile: nhãn xếp trên ô nhập. `readOnly` = ô chỉ đọc (nền nhạt).
 */
export function InlineField({ id, label, required, error, readOnly, labelClass = "sm:min-w-36", className, children }: {
  id: string; label: string; required?: boolean; error?: string; readOnly?: boolean; labelClass?: string; className?: string; children: ReactNode;
}) {
  return (
    <div className={className}>
      <div className={clsx(
        "flex flex-col overflow-hidden rounded-sm border focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft sm:flex-row",
        error ? "border-danger" : "border-border", readOnly ? "bg-hover/60" : "bg-canvas",
      )}>
        <label htmlFor={id} className={clsx("flex shrink-0 items-center whitespace-nowrap border-b border-border bg-hover px-3 py-1.5 text-sm font-medium text-fg-secondary sm:border-b-0 sm:border-r sm:py-0", labelClass)}>
          {label}{required && <span className="ml-0.5 text-danger">*</span>}
        </label>
        {children}
      </div>
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
