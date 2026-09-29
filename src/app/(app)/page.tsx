import { HomeView } from "@/components/home/HomeView";
import { APP_NAV } from "@/config/app.config";
import { buildNav } from "@/lib/nav";
import { prisma } from "@/lib/prisma";
import { requireActor } from "@/server/auth/session";
import { homeWidgets, loadWidget, quickLinks } from "@/server/home/queries";

export const dynamic = "force-dynamic"; // lời chào và số liệu phụ thuộc thời điểm hiện tại

/**
 * Trang chủ (mã 7). Quyền kiểm ở server TRƯỚC khi có truy vấn nào chạy; mỗi widget tải độc lập (lỗi/quá hạn chỉ
 * làm widget đó hiện "Chưa tải được"); lối tắt và module đều lấy từ `buildNav` nên không bao giờ trỏ tới màn chưa giao.
 */
export default async function HomePage() {
  const actor = await requireActor(); // layout không đủ (xem ghi chú trong layout.tsx)
  const now = new Date();
  const nav = buildNav(APP_NAV, actor.perms);
  const specs = homeWidgets(nav, actor, now);
  const widgets = await Promise.all(specs.map(async (spec) => ({ spec, state: await loadWidget(prisma, spec) })));
  return (
    <HomeView
      fullName={actor.fullName} now={now} modules={nav.filter((m) => m.type === "accordion")}
      quickLinks={quickLinks(nav)} widgets={widgets}
    />
  );
}
