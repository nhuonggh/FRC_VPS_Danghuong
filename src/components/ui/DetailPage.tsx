"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import clsx from "clsx";
import { ArrowLeft, Pencil, Save, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useForm, type DefaultValues, type FieldValues, type UseFormReturn } from "react-hook-form";
import type { ZodType } from "zod";
import { confirm } from "@/lib/confirm-store";
import { registerDirtyGuard } from "@/lib/dirty-guard";
import { NULL_TEXT } from "@/lib/format";
import { toast } from "@/lib/toast";
import { Badge, type BadgeTone } from "./Badge";

export interface TabRenderCtx {
  /** Section đang sửa (chỉ 1 tại 1 thời điểm). */
  editing: string | null;
  saving: boolean;
  beginEdit: (key: string) => void;
  cancelEdit: () => void;
  /** Gọi sau khi lưu THÀNH CÔNG: thoát chế độ sửa + toast + refresh dữ liệu. */
  finishEdit: () => void;
  setDirty: (dirty: boolean) => void;
  setSaving: (saving: boolean) => void;
  setError: (message: string | null) => void;
}

export interface DetailTab {
  key: string;
  label: string;
  count?: number;
  /** Được render như MỘT COMPONENT (key theo tab) → được phép dùng hook (vd `useSectionForm`) bên trong. */
  render: (ctx: TabRenderCtx) => React.ReactNode;
}

export interface DetailSummary {
  imageUrl?: string;
  title: string;
  code?: string;
  badges: { label: string; tone?: BadgeTone }[];
  facts: { label: string; value: React.ReactNode }[];
}

const DISCARD_CONFIRM = {
  title: "Bỏ thay đổi chưa lưu?",
  description: "Các thay đổi trong phần đang sửa sẽ bị mất.",
  confirmLabel: "Bỏ thay đổi",
  danger: true,
} as const;

// ---- Thành phần dùng chung: MỖI module dùng lại, không tự viết ----

export function DetailSection({ title, action, editing, children }: {
  title: string; action: React.ReactNode; editing?: boolean; children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border pb-6 last:border-b-0">
      {/* Đang sửa → header sticky dưới thanh tab để Lưu/Hủy luôn thấy khi cuộn form dài */}
      <div className={clsx("mb-3 flex items-center justify-between gap-3", editing && "sticky top-0 z-header border-b border-border bg-surface py-2")}>
        <h2 className="text-base font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** View mode = TEXT TĨNH (không <input disabled>). Label nhạt & mảnh, value đậm & rõ; min-h-9 khớp input. */
export function DetailField({ label, children }: { label: string; children?: React.ReactNode }) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed border-border pb-2">
      <dt className="text-xs font-normal text-fg-muted">{label}</dt>
      <dd className="flex min-h-9 items-center text-right text-sm font-semibold text-fg">{empty ? NULL_TEXT : children}</dd>
    </div>
  );
}

export function EditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="flex h-8 w-8 items-center justify-center rounded-sm text-fg-muted hover:bg-hover hover:text-accent">
      <Pencil size={15} aria-hidden />
    </button>
  );
}

/** Hủy-trái / Lưu-phải (không đảo). Đang lưu → cả hai disabled, nút Lưu đổi thành "Đang lưu". */
export function EditActions({ saving, onSave, onCancel }: { saving: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onCancel} disabled={saving} aria-label="Hủy chỉnh sửa" title="Hủy chỉnh sửa"
        className="flex h-9 w-9 items-center justify-center rounded-sm border border-border text-fg-secondary hover:bg-hover disabled:opacity-50">
        <X size={16} aria-hidden />
      </button>
      <button type="button" onClick={onSave} disabled={saving}
        className="flex h-9 items-center gap-1.5 rounded-sm bg-accent px-3 text-sm font-medium text-fg-on-accent disabled:opacity-60">
        <Save size={15} aria-hidden />{saving ? "Đang lưu" : "Lưu"}
      </button>
    </div>
  );
}

// ---- Điều hướng: ?tab= (sai → tab đầu) và ?edit= (dùng 1 lần) ----

/**
 * `sectionTab`: section → tab chứa nó. Có khai báo thì `?edit=` sai tên bị bỏ qua; `?edit=` không kèm `?tab=`
 * nhảy tới tab chứa section. `?edit=` là tham số 1 lần dùng: gỡ khỏi URL (ghi thêm `?tab=` nếu tab suy ra từ
 * section khác tab đầu — nếu không, sau khi gỡ trang sẽ rơi về tab đầu và mất section đang sửa).
 */
export function useDetailNav(tabKeys: readonly string[], sectionTab: Record<string, string> = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const editParam = sp.get("edit");
  const rawTab = sp.get("tab");
  const wanted = rawTab ?? (editParam ? sectionTab[editParam] : null);
  const activeTab = wanted && tabKeys.includes(wanted) ? wanted : tabKeys[0]!;
  const [initialEditing] = useState<string | null>(() => {
    if (!editParam) return null;
    if (Object.keys(sectionTab).length === 0) return editParam; // không khai báo → không kiểm được, tin URL
    // Section phải tồn tại VÀ nằm đúng tab đang mở; nếu không (vd ?tab=roles&edit=basic) → bỏ qua, không bật edit "ma"
    return Object.hasOwn(sectionTab, editParam) && sectionTab[editParam] === activeTab ? editParam : null;
  });
  const consumed = useRef(false);

  useEffect(() => {
    if (!editParam || consumed.current) return;
    consumed.current = true; // StrictMode chạy effect 2 lần → vẫn chỉ gỡ 1 lần
    const next = new URLSearchParams(sp.toString());
    next.delete("edit");
    if (rawTab === null && activeTab !== tabKeys[0]) next.set("tab", activeTab);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { activeTab, initialEditing, onTabChange: (key: string) => router.push(`${pathname}?tab=${key}`) };
}

// ---- Form của 1 section: nạp lại giá trị khi vào sửa, báo dirty, lưu qua callback ----

export function useSectionForm<T extends FieldValues>(
  ctx: TabRenderCtx,
  key: string,
  opts: { schema: ZodType<T>; defaults: DefaultValues<T>; save: (values: T) => Promise<void> },
): { form: UseFormReturn<T>; editing: boolean; onSave: () => void; onCancel: () => void; saving: boolean } {
  const form = useForm<T>({ resolver: zodResolver(opts.schema as never), defaultValues: opts.defaults });
  const editing = ctx.editing === key;
  const busy = useRef(false); // chặn bấm đúp kể cả trước khi state `saving` kịp cập nhật
  // Nạp lại giá trị gốc khi VÀO sửa (dữ liệu có thể đã đổi sau router.refresh; bỏ chữ gõ dở của lần Hủy trước).
  // useLayoutEffect: áp ngay trong lần commit này — với useEffect (chạy muộn) form có thể hiện giá trị cũ 1 nhịp.
  useLayoutEffect(() => { if (editing) form.reset(opts.defaults); }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = form.formState.isDirty;
  useEffect(() => { if (editing) ctx.setDirty(dirty); }, [editing, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = form.handleSubmit(async (values) => {
    ctx.setSaving(true);
    ctx.setError(null);
    try {
      await opts.save(values);
      ctx.finishEdit();
    } catch (e) {
      ctx.setError(e instanceof Error ? e.message : "Không lưu được, vui lòng thử lại.");
    } finally {
      ctx.setSaving(false);
    }
  });
  const onSave = () => {
    if (busy.current) return;
    busy.current = true;
    void submit().finally(() => { busy.current = false; });
  };
  return { form, editing, onSave, onCancel: ctx.cancelEdit, saving: ctx.saving };
}

// ---- Trang ----

interface Props {
  backHref: string;
  backLabel: string;
  headerActions?: React.ReactNode;
  summary: DetailSummary;
  tabs: DetailTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  initialEditing?: string | null;
  /** Hiện mọi phần xếp dọc trên MỘT màn hình (nav bên trái cuộn tới phần) thay vì chuyển tab. */
  stacked?: boolean;
  /** Compact document layout; summary stays visible beside long sections. */
  compact?: boolean;
  /** Mặc định router.refresh(). */
  onSaved?: () => void;
}

/** Mỗi tab là 1 component riêng (key theo tab) để `render` dùng được hook mà không làm lệch thứ tự hook khi đổi tab. */
function TabBody({ tab, ctx }: { tab: DetailTab; ctx: TabRenderCtx }) {
  return <>{tab.render(ctx)}</>;
}

export function DetailPage({
  backHref, backLabel, headerActions, summary, tabs, activeTab, onTabChange, initialEditing = null, onSaved, stacked = false, compact = false,
}: Props) {
  const router = useRouter();
  const selected = tabs.some((t) => t.key === activeTab) ? activeTab : tabs[0]!.key;
  const firstTab = tabs[0]?.key;
  useEffect(() => {
    if (compact && stacked && selected !== firstTab) document.getElementById(`sec-${selected}`)?.scrollIntoView?.({ block: "start" });
  }, [compact, stacked, selected, firstTab]);
  const [editing, setEditing] = useState<string | null>(initialEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirtyState, setDirtyState] = useState(false);
  const dirty = useRef(false);

  const setDirty = (d: boolean) => { dirty.current = d; setDirtyState(d); };
  const editingRef = useRef(editing);
  editingRef.current = editing;
  useEffect(() => registerDirtyGuard(() => !!editingRef.current && dirty.current), []); // điều hướng trong app hỏi trước khi bỏ section đang sửa dở

  // Rời trang (đóng tab, F5, gõ URL khác) khi còn thay đổi chưa lưu → cảnh báo của trình duyệt
  useEffect(() => {
    if (!editing || !dirtyState) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [editing, dirtyState]);

  const guard = async () => !editing || !dirty.current || (await confirm(DISCARD_CONFIRM));

  const reset = (next: string | null) => { setDirty(false); setError(null); setEditing(next); };

  const ctx: TabRenderCtx = {
    editing, saving,
    beginEdit: async (key) => { if (!saving && key !== editing && (await guard())) reset(key); },
    cancelEdit: async () => { if (!saving && (await guard())) reset(null); },
    finishEdit: () => {
      reset(null);
      toast.success("Đã lưu thay đổi.");
      (onSaved ?? (() => router.refresh()))();
    },
    setDirty, setSaving, setError,
  };

  async function changeTab(key: string) {
    if (key === selected || saving) return;
    if (await guard()) { reset(null); onTabChange(key); }
  }
  function navigateSection(key: string) {
    if (!stacked) { void changeTab(key); return; }
    document.getElementById(`sec-${key}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    if (compact) onTabChange(key);
  }

  async function onBackClick(e: React.MouseEvent) {
    if (saving) { e.preventDefault(); return; } // đang lưu: không rời trang (như tab/Hủy)
    if (!editing || !dirty.current) return; // không có gì để mất → để <Link> điều hướng bình thường
    e.preventDefault();
    if (await confirm(DISCARD_CONFIRM)) router.push(backHref);
  }

  const current = tabs.find((t) => t.key === selected)!;
  const label = (t: DetailTab) => `${t.label}${t.count != null ? ` (${t.count})` : ""}`;

  return (
    <div className="w-full">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={backHref} onClick={onBackClick} className="inline-flex min-h-10 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg">
          <ArrowLeft size={16} aria-hidden /> {backLabel}
        </Link>
        <div className="flex flex-wrap items-center gap-2">{headerActions}</div>
      </div>

      {error && (
        <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">
          <span>{error}</span>
          <button type="button" aria-label="Đóng thông báo lỗi" onClick={() => setError(null)}><X size={16} aria-hidden /></button>
        </div>
      )}

      {/* ≥ 1024: 2 panel stretch cùng chiều cao hàng grid + min-height chung → không lệch/nhảy khi đổi tab */}
      <div className="grid gap-4 lg:min-h-[calc(100dvh-11rem)] lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className={clsx("border border-border bg-surface", compact ? "rounded-md lg:sticky lg:top-4 lg:max-h-[calc(100dvh-12rem)] lg:self-start lg:overflow-y-auto" : "rounded-sm")}>
          {summary.imageUrl && (
            <div className="aspect-video overflow-hidden rounded-t-sm bg-hover">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={summary.imageUrl} alt="" className="h-full w-full object-cover" />
            </div>
          )}
          <div className="space-y-3 p-4">
            <div>
              <h1 className="text-lg font-semibold leading-snug">{summary.title}</h1>
              {summary.code && <p className="mt-1 break-all font-mono text-xs text-fg-muted">{summary.code}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {summary.badges.map((b) => <Badge key={b.label} tone={b.tone}>{b.label}</Badge>)}
            </div>
            <dl className="space-y-2 border-t border-border pt-3 text-sm">
              {summary.facts.map((f) => (
                <div key={f.label} className="flex items-center justify-between gap-3">
                  <dt className="text-fg-muted">{f.label}</dt>
                  <dd className="tabular text-right">{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          {/* Nav tab dọc — chỉ ≥ 1024. < 1024 dùng thanh tab ngang trong <main>. */}
          <nav className="hidden border-t border-border p-2 lg:block" aria-label="Các phần">
            {tabs.map((t) => (
              <button key={t.key} type="button" onClick={() => navigateSection(t.key)} aria-current={(!stacked || compact) && selected === t.key ? "page" : undefined}
                className={clsx("flex w-full items-center rounded-sm px-3 text-left text-sm", compact ? "min-h-11" : "min-h-10", (!stacked || compact) && selected === t.key ? "bg-accent-soft font-medium text-accent" : "text-fg-secondary hover:bg-hover hover:text-fg")}>
                {label(t)}
              </button>
            ))}
          </nav>
        </aside>

        <div className={clsx("min-w-0 border border-border bg-surface", compact ? "rounded-md" : "rounded-sm")}>
          <div className="flex overflow-x-auto border-b border-border px-2 lg:hidden">
            {tabs.map((t) => (
              <button key={t.key} type="button" onClick={() => navigateSection(t.key)} aria-current={(!stacked || compact) && selected === t.key ? "page" : undefined}
                className={clsx("min-h-12 shrink-0 border-b-2 px-3 text-sm font-medium", (!stacked || compact) && selected === t.key ? "border-accent text-accent" : "border-transparent text-fg-secondary")}>
                {label(t)}
              </button>
            ))}
          </div>
          {stacked ? (
            <div className="divide-y divide-border">
              {tabs.map((t) => (
                <section key={t.key} id={`sec-${t.key}`} className={clsx("scroll-mt-4 space-y-4 p-4", compact ? "sm:p-5" : "sm:p-6")}>
                  <h2 className="text-base font-semibold">{label(t)}</h2>
                  <TabBody tab={t} ctx={ctx} />
                </section>
              ))}
            </div>
          ) : <div className="space-y-6 p-4 sm:p-6"><TabBody key={selected} tab={current} ctx={ctx} /></div>}
        </div>
      </div>
    </div>
  );
}
