"use client";

import "./globals.css"; // thay thế root layout nên phải tự nạp CSS token
import { useEffect } from "react";
import { ErrorPanel } from "@/components/ui/ErrorPanel";

/** Lỗi ngay trong root layout/Providers. Tự dựng <html>/<body>; không dựa vào Providers hay script theme (theme theo hệ thống). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);
  return (
    <html lang="vi">
      <body className="bg-canvas text-fg antialiased" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <main className="flex min-h-dvh items-center justify-center">
          <ErrorPanel digest={error.digest} reset={reset} />
        </main>
      </body>
    </html>
  );
}
