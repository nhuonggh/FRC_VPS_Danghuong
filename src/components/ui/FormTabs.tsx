"use client";

import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/** Một nhóm thông tin của form thêm/sửa. Mọi tab dùng chung 1 form state và 1 nút Lưu của NewPage. */
export interface FormTab {
  /** Slug ổn định, đồng bộ lên `?tab=` (vd "cong-no"). Tab đầu tiên luôn là "Thông tin cơ bản". */
  key: string;
  label: string;
  icon: LucideIcon;
  /** Tiền tố tên field react-hook-form thuộc tab (vd ["debtLimit","allowCredit"], ["lines"]) → gom lỗi để hiện chấm đỏ. */
  fields?: readonly string[];
  /** Tab chỉ có dữ liệu sau khi bản ghi tồn tại (lịch sử…): vô hiệu kèm gợi ý. */
  disabled?: boolean;
  disabledHint?: string;
  /** Tab chỉ đọc (lịch sử): không tham gia validate/lưu. Chỉ là dấu hiệu hiển thị. */
  readOnly?: boolean;
  render: () => React.ReactNode;
}

/** Trả về khoá các tab có lỗi (theo thứ tự tab) từ `formState.errors` của react-hook-form. */
export function tabsWithErrors(errors: Record<string, unknown>, tabs: readonly FormTab[]): string[] {
  return tabs.filter((t) => !t.disabled && (t.fields ?? []).some((f) => Object.hasOwn(errors, f))).map((t) => t.key);
}

/** Đồng bộ tab đang chọn với `?tab=` (replace — không đẩy lịch sử mỗi lần đổi tab). Chỉ render khi form có tab. */
export function FormTabUrlSync({ tabs, active, onChange }: { tabs: readonly FormTab[]; active: string; onChange: (key: string) => void }) {
  const router = useRouter(), pathname = usePathname(), sp = useSearchParams();
  const wanted = sp.get("tab");
  const initial = useRef(true);
  // Lần đầu: nhận ?tab= hợp lệ (không phải tab bị vô hiệu); sau đó: ghi ngược active lên URL.
  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      const t = tabs.find((x) => x.key === wanted);
      if (t && !t.disabled && t.key !== active) onChange(t.key);
      return;
    }
    if (wanted === active || (wanted === null && active === tabs[0]!.key)) return;
    const next = new URLSearchParams(sp.toString());
    if (active === tabs[0]!.key) next.delete("tab"); else next.set("tab", active);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

interface NavProps { tabs: readonly FormTab[]; active: string; errorTabs: readonly string[]; onSelect: (key: string) => void }

function TabButton({ tab, active, hasError, onSelect, horizontal }: { tab: FormTab; active: boolean; hasError: boolean; onSelect: (key: string) => void; horizontal: boolean }) {
  const Icon = tab.icon;
  return (
    <button
      type="button" role="tab" id={`tab-${tab.key}${horizontal ? "-h" : ""}`} aria-selected={active} aria-controls={`panel-${tab.key}`}
      aria-disabled={tab.disabled || undefined} disabled={tab.disabled} title={tab.disabled ? tab.disabledHint ?? "Lưu trước để xem" : undefined}
      tabIndex={active ? 0 : -1}
      onClick={() => onSelect(tab.key)}
      className={clsx(
        horizontal ? "flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm font-medium" : "flex min-h-10 w-full items-center gap-2 rounded-sm px-3 text-left text-sm",
        active ? (horizontal ? "border-accent text-accent" : "bg-accent-soft font-medium text-accent") : (horizontal ? "border-transparent text-fg-secondary" : "text-fg-secondary hover:bg-hover hover:text-fg"),
        tab.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-fg-secondary",
      )}
    >
      <Icon size={16} aria-hidden />
      <span className="flex-1">{tab.label}</span>
      {hasError && <span role="img" aria-label={`Tab ${tab.label} có lỗi`} className="h-2 w-2 rounded-full bg-danger" />}
    </button>
  );
}

function onKeys(e: React.KeyboardEvent<HTMLElement>, tabs: readonly FormTab[], active: string, onSelect: (k: string) => void) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const enabled = tabs.filter((t) => !t.disabled);
  const i = enabled.findIndex((t) => t.key === active);
  const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
  const to = enabled[(i + step + enabled.length) % enabled.length];
  if (!to) return;
  e.preventDefault();
  onSelect(to.key);
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[role=tab][aria-selected=true]:not([hidden])`)?.focus());
}

/** Thanh tab dọc (≥1024px) đặt trong panel trái, dưới card tiêu đề. */
export function FormTabsNav({ tabs, active, errorTabs, onSelect }: NavProps) {
  return (
    <div role="tablist" aria-orientation="vertical" aria-label="Các nhóm thông tin" className="hidden border-t border-border p-2 lg:block" onKeyDown={(e) => onKeys(e, tabs, active, onSelect)}>
      {tabs.map((t) => <TabButton key={t.key} tab={t} active={t.key === active} hasError={errorTabs.includes(t.key)} onSelect={onSelect} horizontal={false} />)}
    </div>
  );
}

/** Thanh tab ngang cuộn được (<1024px) phía trên nội dung. */
export function FormTabsBar({ tabs, active, errorTabs, onSelect, className }: NavProps & { className?: string }) {
  return (
    <div role="tablist" aria-orientation="horizontal" aria-label="Các nhóm thông tin" className={clsx("flex overflow-x-auto border-b border-border px-2", className ?? "lg:hidden")} onKeyDown={(e) => onKeys(e, tabs, active, onSelect)}>
      {tabs.map((t) => <TabButton key={t.key} tab={t} active={t.key === active} hasError={errorTabs.includes(t.key)} onSelect={onSelect} horizontal />)}
    </div>
  );
}
