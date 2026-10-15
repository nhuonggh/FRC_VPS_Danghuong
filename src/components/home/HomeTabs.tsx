import clsx from "clsx";
import Link from "next/link";

export interface HomeTabItem { key: string; label: string }

/**
 * Thanh tab ngang của Trang chủ (Chức năng · Bán hàng · Giao hàng …). Mỗi tab là một URL `/?tab=<key>` (deep-link,
 * Back/Forward chạy đúng); chỉ tab đang xem mới tải dữ liệu. Tab đầu "Chức năng" là mặc định → URL `/`.
 */
export function HomeTabs({ tabs, active, keepQuery }: { tabs: readonly HomeTabItem[]; active: string; keepQuery?: string }) {
  return (
    <nav aria-label="Tổng quan theo mục" className="-mx-1 overflow-x-auto border-b border-border">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((t, i) => {
          const isActive = t.key === active;
          const href = i === 0 ? "/" : `/?tab=${t.key}${keepQuery ? `&${keepQuery}` : ""}`;
          return (
            <li key={t.key}>
              <Link
                href={href} scroll={false} aria-current={isActive ? "page" : undefined}
                className={clsx(
                  "-mb-px inline-flex min-h-11 items-center border-b-2 px-4 text-sm font-semibold transition-colors duration-150 ease-standard",
                  isActive ? "border-accent text-accent" : "border-transparent text-fg-secondary hover:bg-hover hover:text-fg",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
