import { notFound } from "next/navigation";
import { requireActor } from "@/server/auth/session";

/**
 * Bắt mọi URL KHÔNG khớp route nào của người đã đăng nhập để 404 hiện TRONG khung (`(app)/not-found.tsx`, giữ Sidebar/Header)
 * thay vì trang 404 mặc định của Next. Catch-all có độ ưu tiên THẤP NHẤT: route tĩnh/động cụ thể (`/m/[module]`, `/system/...`)
 * luôn thắng. Vẫn tự gọi `requireActor()` (không dựa vào layout/middleware).
 */
export default async function UnmatchedPage() {
  await requireActor();
  notFound();
}
