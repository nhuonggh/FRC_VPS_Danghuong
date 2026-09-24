"use client";

import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useEffect } from "react";
import { useToastStore, type ToastItem } from "@/lib/toast";

const AUTO_DISMISS_MS = 4000;
const MAX_VISIBLE = 3;

const STYLE = {
  success: { Icon: CheckCircle2, bar: "border-success", icon: "text-success" },
  error: { Icon: XCircle, bar: "border-danger", icon: "text-danger" },
  warning: { Icon: AlertTriangle, bar: "border-warning", icon: "text-warning" },
  info: { Icon: Info, bar: "border-info", icon: "text-info" },
} as const;

function ToastView({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  useEffect(() => {
    if (item.kind === "error") return; // lỗi cần đọc kỹ: không tự tắt
    const t = setTimeout(() => dismiss(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [item.id, item.kind, dismiss]);
  const { Icon, bar, icon } = STYLE[item.kind];
  return (
    // Lỗi = role=alert (assertive, đọc ngay); còn lại = role=status (polite). Xem ToastHost về vùng live.
    <div role={item.kind === "error" ? "alert" : "status"} className={clsx("flex items-start gap-3 rounded-md border-l-[3px] bg-raised p-3 shadow-md", bar)}>
      <Icon size={18} aria-hidden className={clsx("mt-0.5 shrink-0", icon)} />
      <p className="min-w-0 flex-1 text-sm">{item.message}</p>
      {item.action && (
        <button type="button" onClick={() => { item.action!.onClick(); dismiss(item.id); }} className="min-h-6 text-sm font-semibold text-accent">
          {item.action.label}
        </button>
      )}
      <button type="button" aria-label="Đóng thông báo" onClick={() => dismiss(item.id)} className="text-fg-muted hover:text-fg">
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Tối đa 3 toast MỚI NHẤT; phần cũ hơn gộp "+N thông báo khác" (hiện lại khi bớt toast).
 *
 * A11y: vùng bao luôn có mặt trong DOM (kể cả khi chưa có toast) và là `aria-live="polite"` +
 * `aria-relevant="additions"` — trình đọc màn hình chỉ đăng ký vùng live TỪ TRƯỚC, nên thêm con vào vùng có sẵn
 * mới được đọc tin cậy (khác với vùng vừa được tạo cùng lúc với nội dung). Từng toast tự mang role: `status`
 * (polite) cho success/info/warning, `alert` (assertive, ngắt lời) riêng cho lỗi.
 */
export function ToastHost() {
  const items = useToastStore((s) => s.items);
  const shown = items.slice(-MAX_VISIBLE);
  const hidden = items.length - shown.length;
  return (
    <div aria-live="polite" aria-relevant="additions" className="pointer-events-none fixed inset-x-3 bottom-16 z-toast flex flex-col items-end gap-2 md:inset-x-auto md:bottom-auto md:right-4 md:top-16">
      {shown.map((i) => (
        <div key={i.id} className="pointer-events-auto w-full max-w-sm"><ToastView item={i} /></div>
      ))}
      {hidden > 0 && <div className="pointer-events-auto text-xs text-fg-muted">+{hidden} thông báo khác</div>}
    </div>
  );
}
