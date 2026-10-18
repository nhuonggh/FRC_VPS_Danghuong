import clsx from "clsx";

export function ListPageLayout({
  title, description, actions, stats, statsClassName, filters, footer, children, notes,
}: {
  title: string;
  description?: string;
  /** Thêm mới / Import / Export — luôn hiển thị cả khi danh sách rỗng. */
  actions?: React.ReactNode;
  stats?: React.ReactNode;
  /** Một số màn hình cần KPI trải theo lưới thay vì cụm flex tự co. */
  statsClassName?: string;
  filters?: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
  notes?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold">{title}</h1>{description && <p className="mt-1 text-sm text-fg-secondary">{description}</p>}</div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {stats && <div className={clsx("flex flex-wrap gap-3", statsClassName)}>{stats}</div>}
      {filters}
      {/* .page-container: khung cố định; chỉ vùng bảng cuộn, footer phân trang không nhảy */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-surface">
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer}
      </div>
      {notes && <section aria-label="Ghi chú" className="rounded-md border border-border bg-surface p-3 text-sm text-fg-secondary">{notes}</section>}
    </div>
  );
}
