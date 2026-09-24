import clsx from "clsx";
import Link from "next/link";
import { formatNumber } from "@/lib/format";

/** Dải tóm tắt theo trạng thái; là `<Link>` khi có `href` để bấm lọc. `value` null → "—" (không phải 0). */
export function StatCard({
  label, value, tone = "neutral", href, active,
}: {
  label: string;
  value: number | null;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  href?: string;
  active?: boolean;
}) {
  const valueColor = { neutral: "text-fg", success: "text-success", warning: "text-warning", danger: "text-danger", info: "text-info" }[tone];
  const body = (
    <>
      <span className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">{label}</span>
      <span className={clsx("tabular text-2xl font-bold", valueColor)}>{formatNumber(value)}</span>
    </>
  );
  const cls = clsx(
    "flex min-w-32 flex-1 flex-col gap-1 rounded-md border bg-surface p-3",
    active ? "border-accent bg-accent-soft" : "border-border",
    href && "transition-colors hover:bg-hover",
  );
  return href ? <Link href={href} className={cls} aria-current={active ? "true" : undefined}>{body}</Link> : <div className={cls}>{body}</div>;
}
