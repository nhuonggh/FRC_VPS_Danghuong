"use client";

import clsx from "clsx";
import { ArrowLeft, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FormTabsBar, FormTabsNav, FormTabUrlSync, type FormTab } from "./FormTabs";
import { BOTTOM_NAV_OFFSET } from "@/components/shell/layout-constants";
import { confirm } from "@/lib/confirm-store";
import { registerDirtyGuard } from "@/lib/dirty-guard";

interface Props {
  backHref: string;
  backLabel: string;
  /** "Tạo mới người dùng" — hiện ở aside. */
  title: string;
  submitLabel?: string;
  /** Trả về true nếu form đang có thay đổi chưa lưu. */
  isDirty: () => boolean;
  /** Ném Error(message tiếng Việt) khi lỗi — trang hiện banner và GIỮ dữ liệu đã nhập. */
  onSubmit: () => Promise<void>;
  /**
   * Chia form thành các nhóm (tab dọc ở panel trái). Không truyền = hành vi cũ (toàn bộ `children` một trang).
   * Có `tabs` thì `children` bị bỏ qua; mọi panel vẫn mount (ẩn) nên chung 1 form state và chuyển tab không mất dữ liệu.
   */
  tabs?: FormTab[];
  /** Khoá các tab có lỗi validate (xem `tabsWithErrors`) — hiện chấm đỏ; bấm Lưu mà còn lỗi ⇒ nhảy tới tab lỗi đầu tiên. */
  errorTabs?: readonly string[];
  children?: React.ReactNode;
}

const DISCARD_CONFIRM = { title: "Bỏ thay đổi chưa lưu?", confirmLabel: "Bỏ thay đổi", danger: true } as const;

export function NewPage({ backHref, backLabel, title, submitLabel = "Tạo", isDirty, onSubmit, tabs, errorTabs = [], children }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false); // chặn bấm đúp kể cả trước khi state `pending` kịp cập nhật
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const [active, setActive] = useState(tabs?.[0]?.key ?? "");
  const errorRef = useRef(errorTabs);
  errorRef.current = errorTabs;
  const activeRef = useRef(active);
  activeRef.current = active;
  const select = (key: string) => { setActive(key); };

  // Điều hướng trong app (tab module, sidebar…) hỏi sổ dirty trước khi rời trang
  useEffect(() => registerDirtyGuard(() => dirtyRef.current()), []);

  // Rời trang khi form còn thay đổi chưa lưu → cảnh báo của trình duyệt (đọc trạng thái mới nhất mỗi lần)
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirtyRef.current()) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  async function leave() {
    if (dirtyRef.current() && !(await confirm(DISCARD_CONFIRM))) return;
    router.push(backHref);
  }

  async function submit() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await onSubmit();
      // Form kiểm tra lỗi xong (handleSubmit không ném khi invalid): còn lỗi ở tab khác ⇒ nhảy tới tab lỗi đầu tiên.
      // Chờ 1 nhịp để `errorTabs` (từ formState.errors) kịp cập nhật.
      if (tabs) {
        await new Promise((r) => setTimeout(r, 0));
        const first = errorRef.current[0];
        if (first) {
          if (first !== activeRef.current) setActive(first);
          requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLElement>('[role=tabpanel]:not([hidden]) [aria-invalid="true"]')?.focus()));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tạo được, vui lòng thử lại.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    // <form>: Enter trong ô nhập gửi form (nút Tạo là nút submit duy nhất); mọi đường gửi đều qua submit() (chặn bấm đúp).
    <form className="flex min-h-full flex-col" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="mb-4">
        <Link
          href={backHref}
          onClick={(e) => { if (dirtyRef.current()) { e.preventDefault(); void leave(); } }}
          className="inline-flex min-h-10 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg"
        >
          <ArrowLeft size={16} aria-hidden /> {backLabel}
        </Link>
      </div>
      {error && (
        <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">
          <span>{error}</span>
          <button type="button" aria-label="Đóng thông báo lỗi" onClick={() => setError(null)}><X size={16} aria-hidden /></button>
        </div>
      )}
      <div className="grid flex-1 gap-4 lg:min-h-[calc(100dvh-16rem)] lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className={clsx("rounded-sm border border-border bg-surface", !tabs && "p-4")}>
          <h1 className={clsx("text-lg font-semibold", tabs && "p-4")}>{title}</h1>
          {tabs && <FormTabsNav tabs={tabs} active={active} errorTabs={errorTabs} onSelect={select} />}
        </aside>
        {tabs ? (
          <div className="min-w-0 rounded-sm border border-border bg-surface">
            <FormTabUrlSync tabs={tabs} active={active} onChange={select} />
            <FormTabsBar tabs={tabs} active={active} errorTabs={errorTabs} onSelect={select} />
            <div className="p-4 sm:p-6">
              {tabs.map((t) => <div key={t.key} role="tabpanel" id={`panel-${t.key}`} aria-labelledby={`tab-${t.key}`} hidden={t.key !== active} className="space-y-5">{t.render()}</div>)}
            </div>
          </div>
        ) : (
          <div className="min-w-0 rounded-sm border border-border bg-surface p-4 sm:p-6">{children}</div>
        )}
      </div>
      {/* Footer sticky đáy vùng cuộn (không absolute/fixed che nội dung). Sticky bám mép vùng cuộn, còn BottomNav
          (fixed, z cao hơn) phủ lên đáy vùng đó ở < md → dính CÁCH đáy đúng chiều cao BottomNav (BOTTOM_NAV_OFFSET).
          `pb-20` của vùng cuộn chỉ chừa chỗ cho cuối trang, không giữ footer khỏi bị BottomNav che. */}
      <div className={clsx("sticky bottom-0 z-header mt-4 flex justify-end gap-2 border-t border-border bg-surface px-4 py-3", BOTTOM_NAV_OFFSET)}>
        <button type="button" onClick={() => void leave()} disabled={pending} className="h-11 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover disabled:opacity-50 md:h-10">Hủy</button>
        <button type="submit" disabled={pending} className="h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-60 md:h-10">
          {pending ? "Đang lưu" : submitLabel}
        </button>
      </div>
    </form>
  );
}
