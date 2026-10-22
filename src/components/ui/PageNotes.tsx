/** Khối "Ghi chú" cuối trang: luôn nằm đáy khung trang (shrink-0), không bị nội dung phía trên đẩy xuống. */
export function PageNotes({ children, label = "Ghi chú" }: { children: React.ReactNode; label?: string }) {
  return (
    <section aria-label={label} className="shrink-0 space-y-2 rounded-md border border-border bg-surface p-4 text-sm text-fg-secondary">
      <h2 className="text-sm font-semibold text-fg">Ghi chú</h2>
      {children}
    </section>
  );
}
