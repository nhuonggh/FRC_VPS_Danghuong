"use client";

/**
 * Nội dung trang lỗi 500 dùng cho các ranh giới lỗi NGOÀI khung (`app/error.tsx`, `app/global-error.tsx`).
 * Chỉ nhận `digest` + `reset` — cố ý KHÔNG nhận `error` để không thể in message/stack (có thể chứa SQL, host, đường dẫn).
 * Dùng thẻ <a> (tải lại trang) thay vì next/link: global-error chạy khi cả cây React/router có thể đã hỏng.
 */
export function ErrorPanel({ digest, reset }: { digest?: string; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-semibold">Có lỗi xảy ra</h1>
      <p className="max-w-md text-fg-secondary">
        Hệ thống chưa xử lý được yêu cầu. Bạn hãy thử lại; nếu vẫn lỗi, báo mã bên dưới cho người hỗ trợ.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={reset} className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent hover:bg-accent-600">
          Thử lại
        </button>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- cố ý tải lại toàn trang, không phụ thuộc router */}
        <a href="/" className="rounded-sm border border-border bg-surface px-4 py-2 text-sm hover:bg-hover">
          Về trang chủ
        </a>
      </div>
      {digest && <p className="text-xs text-fg-muted">Mã lỗi: {digest}</p>}
    </div>
  );
}
