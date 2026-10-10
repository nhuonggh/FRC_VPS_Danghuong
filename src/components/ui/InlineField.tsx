import clsx from "clsx";
import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

/** Ô nhập trong khung ghép của InlineField: không viền riêng, chiều cao 44px mobile / 36px desktop. */
export const igInput = "h-11 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none read-only:text-fg-secondary disabled:opacity-60 md:h-9";
/** Ô nhập nhiều dòng trong InlineField `multiline`. */
export const igArea = "min-w-0 flex-1 resize-y bg-transparent px-3 py-2 text-sm outline-none read-only:text-fg-secondary disabled:opacity-60";
/** Bọc Combobox/chọn có viền riêng để nó hòa vào khung ghép của InlineField (bỏ viền + bo góc của chính nó). */
export const igCombo = "min-w-0 flex-1 [&_input]:h-11 [&_input]:rounded-none [&_input]:border-0 [&_input]:bg-transparent [&_input]:outline-none md:[&_input]:h-9";

/** Gắn aria-describedby (lỗi/gợi ý) vào ô nhập có đúng `id` của trường, trừ khi ô tự khai báo. */
function describe(children: ReactNode, id: string, ref?: string): ReactNode {
  if (!ref) return children;
  return Children.map(children, (child) => (isValidElement(child) && (child.props as { id?: string }).id === id && !(child.props as Record<string, unknown>)["aria-describedby"] ? cloneElement(child as ReactElement<Record<string, unknown>>, { "aria-describedby": ref }) : child));
}

/**
 * Ô nhập chuẩn của mọi form: nhãn nền xám ở bên trái, ô nhập bên phải, chung một khung viền.
 * Mobile: nhãn xếp trên ô nhập. `readOnly` = ô chỉ đọc (nền nhạt). `multiline` = ô nhiều dòng (nhãn bám đầu ô).
 */
export function InlineField({ id, label, required, error, hint, readOnly, multiline, labelClass = "sm:min-w-36", className, children }: {
  id: string; label: string; required?: boolean; error?: string; hint?: string; readOnly?: boolean; multiline?: boolean; labelClass?: string; className?: string; children: ReactNode;
}) {
  return (
    <div className={className}>
      <div className={clsx(
        "flex flex-col overflow-hidden rounded-sm border focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft sm:flex-row",
        error ? "border-danger" : "border-border", readOnly ? "bg-hover/60" : "bg-canvas",
      )}>
        <label htmlFor={id} className={clsx("flex shrink-0 whitespace-nowrap border-b border-border bg-hover px-3 py-1.5 text-sm font-medium text-fg-secondary sm:border-b-0 sm:border-r", multiline ? "items-start sm:pt-2" : "items-center sm:py-0", labelClass)}>
          {label}{required && <span className="ml-0.5 text-danger">*</span>}
        </label>
        {describe(children, id, error ? `${id}-error` : hint ? `${id}-hint` : undefined)}
      </div>
      {error ? <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-danger">{error}</p> : hint ? <p id={`${id}-hint`} className="mt-1 text-xs text-fg-muted">{hint}</p> : null}
    </div>
  );
}
