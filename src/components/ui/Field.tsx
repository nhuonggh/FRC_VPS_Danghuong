import type { ReactNode } from "react";
import clsx from "clsx";

/** Ô nhập chuẩn: 44px trên mobile, 36px trên desktop; lỗi luôn được công bố cho trợ năng. */
export const inputClass = (error?: unknown) => clsx("h-11 w-full rounded-sm border bg-canvas px-3 text-sm outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent-soft md:h-9", error ? "border-danger" : "border-border");

export function Field({ id, label, error, hint, required, className, children }: { id: string; label: string; error?: string; hint?: string; required?: boolean; className?: string; children: ReactNode }) {
  const description = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return <div className={className}>
    <label htmlFor={id} className="mb-1 block text-xs text-fg-muted">{label}{required && <span className="text-danger"> *</span>}</label>
    {children}
    {error ? <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-danger">{error}</p> : hint ? <p id={`${id}-hint`} className="mt-1 text-xs text-fg-muted">{hint}</p> : null}
    {/* Children nhận aria-describedby trực tiếp; marker này chỉ giữ id contract rõ ràng. */}
    {description ? null : null}
  </div>;
}
