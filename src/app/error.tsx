"use client";

import { useEffect } from "react";
import { ErrorPanel } from "@/components/ui/ErrorPanel";

/**
 * Lỗi mà `(app)/error.tsx` không bắt được: chính layout `(app)` (vd DB sập trong `requireActor()`), trang đăng nhập,
 * `/403`, `/change-password`. Render TRONG root layout nên đã có font + token. Không in error.message/stack.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas text-fg">
      <ErrorPanel digest={error.digest} reset={reset} />
    </main>
  );
}
