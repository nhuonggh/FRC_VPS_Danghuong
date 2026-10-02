import { DashboardView } from "@/components/home/dashboard/DashboardView";
import { HomeTabs } from "@/components/home/HomeTabs";
import { HomeView } from "@/components/home/HomeView";
import { QuickTimeFilter } from "@/components/ui/QuickTimeFilter";
import { APP_NAV } from "@/config/app.config";
import { buildNav } from "@/lib/nav";
import { prisma } from "@/lib/prisma";
import { parseListParams } from "@/lib/query-params";
import { requireActor } from "@/server/auth/session";
import { DASH_TABS, isDashTabKey, loadDashboard, visibleDashTabs } from "@/server/home/dashboard";
import type { Dashboard } from "@/server/home/dashboard/types";
import { withTimeout } from "@/server/home/queries";
import { homeWidgets, loadWidget } from "@/server/home/queries";

export const dynamic = "force-dynamic"; // lời chào và số liệu phụ thuộc thời điểm hiện tại

const DASH_TIMEOUT_MS = 15_000;

const TITLES: Record<string, { title: string; desc: string }> = {
  sales: { title: "Tổng quan bán hàng", desc: "Theo dõi tình hình doanh thu, đơn hàng, khách hàng và công nợ bán hàng" },
  delivery: { title: "Tổng quan giao hàng", desc: "Theo dõi tình trạng giao hàng, lịch xe, hàng đang giao và hiệu quả vận chuyển" },
  purchase: { title: "Tổng quan nhập hàng", desc: "Theo dõi tình hình nhập hàng, giá trị, nhà cung cấp và hàng hóa theo thời gian" },
  inventory: { title: "Tổng quan kho", desc: "Tồn kho hiện tại theo mặt hàng, nhóm hàng, định mức và biến động nhập – xuất" },
  returns: { title: "Tổng quan trả hàng", desc: "Theo dõi hàng khách trả, trả nhà cung cấp và các sản phẩm bị trả nhiều" },
  production: { title: "Tổng quan sản xuất", desc: "Theo dõi lệnh sản xuất, thành phẩm, nguyên vật liệu tiêu hao và kiểm kho" },
  accounting: { title: "Tổng quan kế toán", desc: "Cập nhật tình hình thu chi, quỹ, công nợ và hậu kiểm chứng từ" },
};

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Trang chủ (mã 7). Quyền kiểm ở server TRƯỚC khi có truy vấn nào chạy. Thanh tab ngang: "Chức năng" (mặc định, như cũ)
 * và các tab tổng quan theo mục — tab nào actor không đủ quyền thì không xuất hiện và `?tab=` trỏ vào bị coi như "Chức năng".
 * Chỉ tab đang xem mới chạy truy vấn; mỗi widget "Chức năng" vẫn tải độc lập (lỗi cục bộ).
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireActor(); // layout không đủ (xem ghi chú trong layout.tsx)
  const sp = await searchParams;
  const now = new Date();
  const nav = buildNav(APP_NAV, actor.perms);
  const visible = visibleDashTabs(actor);
  const rawTab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab = isDashTabKey(rawTab) && visible.some((t) => t.key === rawTab) ? rawTab : null;
  const tabItems = [{ key: "functions", label: "Chức năng" }, ...visible.map((t) => ({ key: t.key, label: t.label }))];

  if (tab === null) {
    const specs = homeWidgets(nav, actor, now);
    const widgets = await Promise.all(specs.map(async (spec) => ({ spec, state: await loadWidget(prisma, spec) })));
    return (
      <div className="space-y-6">
        {visible.length > 0 && <HomeTabs tabs={tabItems} active="functions" />}
        <HomeView fullName={actor.fullName} now={now} modules={nav.filter((m) => m.type === "accordion")} widgets={widgets} />
      </div>
    );
  }

  const def = DASH_TABS.find((t) => t.key === tab)!;
  const params = parseListParams(sp);
  const effective = { ...params, timePreset: params.timePreset ?? ("thisMonth" as const) };
  let data: Dashboard | null = null;
  try {
    data = await withTimeout(loadDashboard(prisma, actor, tab, { preset: effective.timePreset, start: params.timeStart, end: params.timeEnd }, now), DASH_TIMEOUT_MS);
  } catch (error) {
    console.error(`[home] dashboard ${tab} lỗi:`, error);
  }
  const t = TITLES[tab]!;
  return (
    <div className="space-y-4">
      <HomeTabs tabs={tabItems} active={tab} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">{t.title}</h1>
          <p className="text-sm text-fg-secondary">{t.desc}</p>
        </div>
        {!def.snapshot && <QuickTimeFilter basePath={`/?tab=${tab}`} params={effective} allowAll={false} />}
      </div>
      {data ? (
        <DashboardView data={data} />
      ) : (
        <div role="alert" className="rounded-md border border-border bg-surface p-6 text-center">
          <p className="text-danger">Chưa tải được số liệu của mục này.</p>
          <a href={`/?tab=${tab}`} className="mt-2 inline-block text-sm font-medium text-accent hover:underline">Thử lại</a>
        </div>
      )}
    </div>
  );
}
