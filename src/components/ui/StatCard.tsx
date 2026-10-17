import clsx from "clsx";
import Link from "next/link";
import { formatCurrency, formatNumber } from "@/lib/format";

/** Dải tóm tắt theo trạng thái; là `<Link>` khi có `href` để bấm lọc. `value` null → "—" (không phải 0). */
export function StatCard({
  label, value, tone = "neutral", href, active, money = false,
}: {
  label: string;
  value: number | string | null;
  money?: boolean;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  href?: string;
  active?: boolean;
}) {
  const valueColor = { neutral: "text-fg", success: "text-success", warning: "text-warning", danger: "text-danger", info: "text-info" }[tone];
  const body = (
    <>
      <span className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">{label}</span>
      <span className={clsx("tabular text-2xl font-bold", valueColor)}>{money ? formatCurrency(value) : formatNumber(value)}</span>
    </>
  );
  const cls = clsx(
    "flex min-w-32 flex-1 flex-col gap-1 rounded-md border p-3",
    // bg-surface CHỈ ở nhánh không active: 2 class nền cùng lúc thì bg-surface (đứng sau trong CSS) thắng
    active ? "border-accent bg-accent-soft" : "border-border bg-surface",
    href && "transition-colors hover:bg-hover",
  );
  return href ? <Link href={href} className={cls} aria-current={active ? "true" : undefined}>{body}</Link> : <div className={cls}>{body}</div>;
}
