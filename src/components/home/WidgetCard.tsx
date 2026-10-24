import Link from "next/link";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { WidgetSpec, WidgetState } from "@/server/home/types";
import { RetryButton } from "./RetryButton";

export type WidgetCardSpec = Pick<WidgetSpec, "key" | "label" | "href" | "format" | "tone">;

/** Thẻ số liệu nhanh của trang chủ. Lỗi/quá hạn ⇒ "Chưa tải được — Thử lại" cục bộ, không bao giờ hiện số 0 giả. */
export function WidgetCard({ spec, state }: { spec: WidgetCardSpec; state: WidgetState }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4" data-widget={spec.key}>
      <p className="text-sm text-fg-secondary">{spec.label}</p>
      {state.ok ? (
        <Link href={spec.href} className="mt-1 block min-h-11 text-2xl font-semibold tabular hover:text-accent" aria-label={`${spec.label}: xem chi tiết`}>
          <span className={spec.tone === "warning" && Number(state.value) > 0 ? "text-warning" : undefined}>
            {spec.format === "currency" ? formatCurrency(state.value) : formatNumber(Number(state.value))}
          </span>
        </Link>
      ) : (
        <div role="alert" className="mt-1">
          <p className="text-sm text-danger">Chưa tải được</p>
          <RetryButton label={spec.label} />
        </div>
      )}
    </div>
  );
}

/** Khung chờ cho thẻ đang tải — trang chủ hiện ngay, từng số liệu về tới đâu hiện tới đó. */
export function WidgetCardSkeleton({ spec }: { spec: WidgetCardSpec }) {
  return (
    <div className="rounded-md border border-border bg-surface p-4" data-widget={spec.key} aria-busy="true">
      <p className="text-sm text-fg-secondary">{spec.label}</p>
      <div className="skeleton mt-2 h-8 w-24" />
    </div>
  );
}
