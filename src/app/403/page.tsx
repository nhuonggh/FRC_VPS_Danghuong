import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas p-6 text-center">
      <h1 className="text-2xl font-semibold">403 — Không có quyền truy cập</h1>
      <p className="max-w-md text-fg-secondary">Tài khoản của bạn chưa được cấp quyền cho chức năng này. Liên hệ giám đốc để được cấp quyền.</p>
      <Link href="/" className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent">Về trang chủ</Link>
    </main>
  );
}
