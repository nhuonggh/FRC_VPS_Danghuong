import clsx from "clsx";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import Link from "next/link";
import { formatNumber } from "@/lib/format";
import { PAGE_SIZES, pageWindow } from "@/lib/pagination";

interface Props {
  total: number;
  page: number;
  pageSize: number;
  /** Tạo href giữ nguyên mọi query khác (search/filter/sort). */
  buildHref: (patch: { page?: number; pageSize?: number }) => string;
}

/** Nút điều hướng: ở biên (disabled) render `<span aria-disabled>` — không còn là link nên không focus/điều hướng được. */
function NavBtn({ label, href, disabled, className, children }: {
  label: string; href: string; disabled: boolean; className: string; children: React.ReactNode;
}) {
  if (disabled) {
    return <span role="link" aria-disabled="true" aria-label={label} className={clsx(className, "opacity-40")}>{children}</span>;
  }
  return <Link aria-label={label} href={href} className={className}>{children}</Link>;
}

const btn = "flex h-8 w-8 items-center justify-center rounded-sm text-sm hover:bg-hover";
const btnMobile = "flex h-11 w-11 items-center justify-center rounded-sm border border-border";

/** LUÔN ở đáy khung (flex-shrink-0 + sticky bottom) dù ít hay nhiều dòng. */
export function PaginationFooter({ total, page: pageIn, pageSize, buildHref }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, pageIn), pages);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const atFirst = page <= 1;
  const atLast = page >= pages;

  return (
    <div className="sticky bottom-0 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-3 py-2 text-sm">
      <div className="flex items-center gap-3 text-fg-secondary">
        <span className="tabular">Hiển thị {formatNumber(from)}–{formatNumber(to)} / Tổng: {formatNumber(total)}</span>
        <nav aria-label="Số dòng mỗi trang" className="hidden items-center gap-1 lg:flex">
          {PAGE_SIZES.map((s) => (
            <Link key={s} href={buildHref({ pageSize: s, page: 1 })} aria-current={s === pageSize ? "true" : undefined}
              className={clsx("rounded-sm px-2 py-1 tabular", s === pageSize ? "bg-accent-soft font-semibold text-accent" : "hover:bg-hover")}>
              {s}
            </Link>
          ))}
        </nav>
      </div>

      {/* PC: nút số trang */}
      <nav aria-label="Phân trang" className="hidden items-center gap-1 lg:flex">
        <NavBtn label="Trang đầu" href={buildHref({ page: 1 })} disabled={atFirst} className={btn}><ChevronsLeft size={16} aria-hidden /></NavBtn>
        <NavBtn label="Trang trước" href={buildHref({ page: page - 1 })} disabled={atFirst} className={btn}><ChevronLeft size={16} aria-hidden /></NavBtn>
        {pageWindow(page, pages).map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1 text-fg-muted">…</span>
          ) : (
            <Link key={p} href={buildHref({ page: p })} aria-current={p === page ? "page" : undefined}
              className={clsx("tabular flex h-8 w-8 items-center justify-center rounded-full text-sm", p === page ? "bg-accent font-semibold text-fg-on-accent" : "hover:bg-hover")}>
              {p}
            </Link>
          ),
        )}
        <NavBtn label="Trang sau" href={buildHref({ page: page + 1 })} disabled={atLast} className={btn}><ChevronRight size={16} aria-hidden /></NavBtn>
        <NavBtn label="Trang cuối" href={buildHref({ page: pages })} disabled={atLast} className={btn}><ChevronsRight size={16} aria-hidden /></NavBtn>
      </nav>

      {/* Mobile/tablet: ‹ Prev — Trang 3/25 — Next › */}
      <nav aria-label="Phân trang" className="flex items-center gap-2 lg:hidden">
        <NavBtn label="Trang trước" href={buildHref({ page: page - 1 })} disabled={atFirst} className={btnMobile}><ChevronLeft size={18} aria-hidden /></NavBtn>
        <span className="tabular text-fg-secondary">Trang {page}/{pages}</span>
        <NavBtn label="Trang sau" href={buildHref({ page: page + 1 })} disabled={atLast} className={btnMobile}><ChevronRight size={18} aria-hidden /></NavBtn>
      </nav>
    </div>
  );
}
