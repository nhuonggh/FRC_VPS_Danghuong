import { AlertTriangle, Inbox, SearchX } from "lucide-react";

const ICON = { empty: Inbox, "no-result": SearchX, error: AlertTriangle } as const;

/**
 * 3 loại (states-and-feedback.md): `empty` (chưa có dữ liệu — action = "Thêm mới"),
 * `no-result` (bộ lọc không khớp — action = "Xóa bộ lọc"), `error` (action = "Thử lại").
 */
export function EmptyState({
  kind, title, description, action,
}: {
  kind: "empty" | "no-result" | "error";
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  const Cmp = ICON[kind];
  return (
    <div role={kind === "error" ? "alert" : undefined} className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <Cmp size={36} aria-hidden className={kind === "error" ? "text-danger" : "text-fg-muted"} />
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="max-w-md text-sm text-fg-secondary">{description}</p>}
      {action}
    </div>
  );
}
