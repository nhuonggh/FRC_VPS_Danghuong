"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * 500 trong khung chính. Người dùng CHỈ thấy thông điệp chung + mã `digest` (để người hỗ trợ tra log máy chủ);
 * KHÔNG in error.message/stack (có thể chứa tên bảng, đường dẫn, SQL).
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app-error]", error);
  }, [error]);
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Có lỗi xảy ra</h1>
      <p className="max-w-md text-fg-secondary">
        Hệ thống chưa xử lý được yêu cầu. Bạn hãy thử lại; nếu vẫn lỗi, báo mã bên dưới cho người hỗ trợ.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={reset} className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent hover:bg-accent-600">
          Thử lại
        </button>
        <Link href="/" className="rounded-sm border border-border bg-surface px-4 py-2 text-sm hover:bg-hover">
          Về trang chủ
        </Link>
      </div>
      {error.digest && <p className="text-xs text-fg-muted">Mã lỗi: {error.digest}</p>}
    </div>
  );
}
