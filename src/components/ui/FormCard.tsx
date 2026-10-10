import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Thẻ một khối của form: icon + tiêu đề (+ nút ở góc phải), nội dung bên dưới. */
export function FormCard({ id, icon: Icon, title, actions, className, children }: { id?: string; icon?: LucideIcon; title: string; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={clsx("scroll-mt-4 rounded-sm border border-border bg-surface p-4", className)}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">{Icon && <Icon size={16} aria-hidden className="text-accent" />} {title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Lưới ô nhập: 1 cột mobile, 2 cột từ md, `cols` cột từ xl. */
export function FormGrid({ cols = 3, className, children }: { cols?: 2 | 3; className?: string; children: ReactNode }) {
  return <div className={clsx("grid gap-x-6 gap-y-3 md:grid-cols-2", cols === 3 && "xl:grid-cols-3", className)}>{children}</div>;
}
