"use client";
import { useEffect } from "react";

/** Gọi `fn` ngay, rồi mỗi `ms` — chỉ khi tab đang hiện; quay lại tab thì gọi lại ngay. */
export function usePoll(fn: () => void, ms = 60_000) {
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") fn(); };
    tick();
    const timer = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms]);
}
