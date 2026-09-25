"use client";

import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Banner cố định (không tự tắt) khi mất mạng; tự ẩn khi có mạng lại.
 * - Vùng `role="status"` luôn có sẵn trong DOM (rỗng khi online) để trình đọc màn hình đọc được nội dung khi nó xuất hiện.
 * - Nằm ngoài luồng bố cục (wrapper cao 0 + banner absolute) → hiện/ẩn không đẩy nội dung trang (không layout shift).
 *   Lớp nền `bg-surface` đặc để chữ trang bên dưới không lộ xuyên qua lớp tint `warning-soft` (trong suốt một phần).
 * - Render ban đầu luôn "online" ở cả server lẫn client (tránh lệch hydration); trạng thái thật đọc trong effect.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    setOffline(!navigator.onLine);
    const off = () => setOffline(true);
    const on = () => setOffline(false);
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, []);
  return (
    <div className="relative z-header h-0">
      <div role="status" aria-live="polite" className={offline ? "absolute inset-x-0 top-0 border-b border-border bg-surface" : undefined}>
        {offline && (
          <div className="flex items-center justify-center gap-2 bg-warning-soft px-3 py-2 text-sm text-warning">
            <WifiOff size={16} aria-hidden /> Mất kết nối mạng — đang thử kết nối lại…
          </div>
        )}
      </div>
    </div>
  );
}
