import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/shell/icons";
import type { NavModule } from "@/config/app.config";
import { greeting } from "@/lib/greeting";
import type { WidgetState } from "@/server/home/types";
import { WidgetCard, type WidgetCardSpec } from "./WidgetCard";

export interface HomeViewProps {
  fullName: string;
  now: Date;
  modules: readonly NavModule[];
  widgets?: readonly { spec: WidgetCardSpec; state: WidgetState }[];
  /** Thay cho `widgets`: các thẻ tự tải trong Suspense để trang hiện ngay, số liệu stream vào sau. */
  widgetsSlot?: ReactNode;
}

const CARD = "flex min-h-11 items-center gap-3 rounded-md border border-border bg-surface transition-shadow duration-150 ease-standard hover:shadow-md";

/**
 * Trang chủ. Chỉ hiển thị thứ actor được phép (đã lọc ở server): widget số liệu THẬT theo quyền, lối tắt, module.
 * Widget lỗi → "Chưa tải được — Thử lại" cục bộ, lời chào và điều hướng vẫn dùng được.
 */
export function HomeView({ fullName, now, modules, widgets = [], widgetsSlot }: HomeViewProps) {
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">{greeting(now)}, {fullName}</h1>

      {(widgetsSlot || widgets.length > 0) && (
        <section aria-label="Số liệu nhanh" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {widgetsSlot ?? widgets.map(({ spec, state }) => <WidgetCard key={spec.key} spec={spec} state={state} />)}
        </section>
      )}

      {modules.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-fg-muted">
          Tài khoản của bạn chưa được cấp quyền vào chức năng nào. Liên hệ giám đốc để được cấp quyền.
        </p>
      ) : (
        <section aria-label="Chức năng" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {modules.map((m) => (
            <Link key={m.key} href={`/m/${m.key}`} className={`${CARD} min-h-28 gap-4 p-5`}>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                <Icon name={m.icon} size={24} />
              </span>
              <span className="min-w-0">
                <span className="block text-base font-semibold">{m.label}</span>
                <span className="text-sm text-fg-secondary">{m.categories.flatMap((c) => c.functions).length} chức năng</span>
              </span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
