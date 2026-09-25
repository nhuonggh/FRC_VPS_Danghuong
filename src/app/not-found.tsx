import Link from "next/link";

/** 404 NGOÀI khung: URL không khớp route nào khi không có ngữ cảnh đăng nhập (người đã đăng nhập thấy bản trong khung — `(app)/[...slug]`). */
export default function RootNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas p-6 text-center text-fg">
      <h1 className="text-2xl font-semibold">Không tìm thấy trang hoặc bản ghi</h1>
      <p className="max-w-md text-fg-secondary">Đường dẫn có thể đã sai hoặc bản ghi đã bị xóa.</p>
      <Link href="/" className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent hover:bg-accent-600">
        Về trang chủ
      </Link>
    </main>
  );
}
