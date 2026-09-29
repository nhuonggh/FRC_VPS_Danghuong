"use client";

import { useRouter } from "next/navigation";

/** Tải lại dữ liệu trang chủ (server component) khi một widget báo lỗi. */
export function RetryButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <button
      type="button" onClick={() => router.refresh()} aria-label={`Thử lại: ${label}`}
      className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline md:min-h-9"
    >
      Thử lại
    </button>
  );
}
