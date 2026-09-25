import Link from "next/link";

/** 404 nằm TRONG layout (app): giữ Sidebar/Header (states-and-feedback.md). */
export default function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Không tìm thấy trang hoặc bản ghi</h1>
      <p className="max-w-md text-fg-secondary">Đường dẫn có thể đã sai hoặc bản ghi đã bị xóa.</p>
      <Link href="/" className="rounded-sm bg-accent px-4 py-2 text-sm font-medium text-fg-on-accent hover:bg-accent-600">
        Về trang chủ
      </Link>
    </div>
  );
}
