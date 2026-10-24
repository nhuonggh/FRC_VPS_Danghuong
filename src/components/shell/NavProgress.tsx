"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const NAV_START = "app:nav-start";
/** Gọi trước `router.push` (bấm dòng, lọc, tìm kiếm…) để thanh tiến trình chạy ngay; link `<a>` nội bộ tự được bắt. */
export function startNavProgress() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(NAV_START));
}

/** Click vào link nội bộ sang trang khác (không mở tab mới, không tải file, không chỉ đổi #hash). */
function isPageNavigation(e: MouseEvent, here: URL): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return false;
  const to = new URL(a.href, here);
  if (to.origin !== here.origin || to.pathname.startsWith("/api/")) return false;
  return to.pathname !== here.pathname || to.search !== here.search;
}

/**
 * Thanh tiến trình mảnh trên cùng: chạy ngay khi bấm chuyển trang, hoàn tất khi URL đổi.
 * Trang server cần vài trăm ms để dựng; thanh này (cùng skeleton ở `loading.tsx`) cho người dùng biết app đang xử lý.
 */
export function NavProgress() {
  const pathname = usePathname(), search = useSearchParams().toString();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  useEffect(() => setState((s) => (s === "loading" ? "done" : s)), [pathname, search]);
  useEffect(() => {
    const start = () => setState("loading");
    const onClick = (e: MouseEvent) => { if (isPageNavigation(e, new URL(window.location.href))) start(); };
    document.addEventListener("click", onClick, true);
    window.addEventListener(NAV_START, start);
    return () => { document.removeEventListener("click", onClick, true); window.removeEventListener(NAV_START, start); };
  }, []);
  useEffect(() => {
    if (state === "idle") return;
    // "done": để thanh chạy hết rồi ẩn. "loading": chốt an toàn nếu điều hướng bị hủy/lỗi thì không treo mãi.
    const t = setTimeout(() => setState("idle"), state === "done" ? 400 : 15000);
    return () => clearTimeout(t);
  }, [state]);
  return <div className="nav-progress" data-state={state} role="progressbar" aria-label="Đang chuyển trang" aria-hidden={state === "idle"} />;
}
