/** Khung chờ hiện ngay khi chuyển trang, trong lúc server dựng trang đích (shell giữ nguyên). */
export default function Loading() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <span className="sr-only">Đang tải…</span>
      <div className="flex items-center justify-between gap-3">
        <div className="skeleton h-7 w-48" />
        <div className="skeleton h-9 w-28" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-20" />)}
      </div>
      <div className="rounded-sm border border-border bg-surface p-3">
        <div className="skeleton mb-3 h-9 w-full max-w-sm" />
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-9 w-full" />)}
        </div>
      </div>
    </div>
  );
}
