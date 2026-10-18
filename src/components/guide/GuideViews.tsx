import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown } from "lucide-react";
import type { NavModule } from "@/config/app.config";
import type { GuideRole } from "@/config/user-guide";
import { moduleGuideHref, roleGuideHref } from "@/lib/guide-links";
import { guideTopics, roleTasks, visibleGuideRoles } from "@/lib/user-guide";
import { Icon } from "@/components/shell/icons";

const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
const link = `inline-flex min-h-11 items-center gap-2 rounded-sm px-3 py-2 text-sm font-medium text-accent hover:bg-accent-soft ${focus}`;
const card = `flex min-h-11 items-center justify-between gap-3 rounded-md border border-border bg-surface p-4 hover:bg-hover ${focus}`;

function GuideHeader({ title, intro, backHref = "/guide", backLabel = "Tất cả hướng dẫn" }: { title: string; intro: string; backHref?: string; backLabel?: string }) {
  return <header className="shrink-0 space-y-3"><Link href={backHref} className={link}><ArrowLeft size={16} aria-hidden />{backLabel}</Link><h1 className="text-xl font-semibold">{title}</h1><p className="text-sm leading-relaxed text-fg-secondary">{intro}</p></header>;
}

export function GuideIndex({ nav, byRole }: { nav: NavModule[]; byRole: boolean }) {
  const modules = nav.filter((m) => m.type === "accordion" && guideTopics(m).length);
  const roles = visibleGuideRoles(nav);
  return <div className="space-y-6">
    <GuideHeader title="Hướng dẫn sử dụng" intro="Bạn muốn làm việc gì? Chọn theo chức năng hoặc theo công việc của bạn để xem các bước." backHref="/" backLabel="Trang chủ" />
    <nav aria-label="Cách xem hướng dẫn" className="flex flex-wrap gap-2 border-b border-border pb-3">
      {[{ href: "/guide", label: "Theo chức năng", on: !byRole }, { href: "/guide?view=roles", label: "Theo công việc của bạn", on: byRole }].map((tab) => <Link key={tab.href} href={tab.href} aria-current={tab.on ? "page" : undefined} className={`${link} ${tab.on ? "bg-accent-soft" : "text-fg-secondary"}`}>{tab.label}</Link>)}
    </nav>
    <GettingStarted />
    <section aria-labelledby="guide-choices" className="space-y-3">
      <h2 id="guide-choices" className="text-lg font-semibold">{byRole ? "Chọn công việc của bạn" : "Chọn phần cần xem"}</h2>
      {byRole ? <>
        <p className="text-sm text-fg-secondary">Chọn công việc để xem thứ tự nên làm. Mỗi tài khoản có thể được giao thêm hoặc bớt việc.</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{roles.map((role) => <Link key={role.key} href={roleGuideHref(role.key)} className={card}><span className="space-y-2"><span className="block font-semibold">{role.label}</span><span className="block text-sm text-fg-secondary">{role.intro}</span></span><ArrowRight size={18} className="shrink-0 text-accent" aria-hidden /></Link>)}</div>
      </> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{modules.map((m) => <Link key={m.key} href={moduleGuideHref(m.key)} className={card}><span className="flex items-center gap-3"><Icon name={m.icon} /><span className="font-semibold">{m.label}</span></span><ArrowRight size={18} className="shrink-0 text-accent" aria-hidden /></Link>)}</div>}
      {(byRole ? !roles.length : !modules.length) && <p className="rounded-md border border-border bg-surface p-4 text-sm text-fg-secondary">Tài khoản chưa được giao chức năng nào. Hãy liên hệ người quản lý để được hướng dẫn và cấp quyền phù hợp.</p>}
    </section>
    <CommonQuestions />
  </div>;
}

function GettingStarted() {
  return <details className="rounded-md border border-border bg-surface p-4">
    <summary className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 font-semibold ${focus}`}>Mới sử dụng? Bắt đầu ở đây<ChevronDown size={18} aria-hidden /></summary>
    <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-relaxed">
      <li>Đăng nhập bằng tài khoản được cấp. Nếu được yêu cầu đổi mật khẩu, đổi trước khi bắt đầu. Quên mật khẩu thì liên hệ người quản lý.</li>
      <li>Ở Trang chủ, chọn phần cần làm. Trên điện thoại, bấm Thêm ở thanh dưới nếu chưa thấy phần đó.</li>
      <li>Trong danh sách, gõ tên hoặc mã để tìm. Không thấy kết quả thì kiểm tra ngày và các điều kiện lọc đang chọn.</li>
      <li>Bấm mã hoặc tên để mở chi tiết. Trên máy tính, đưa chuột lên nút chỉ có hình để xem tên thao tác.</li>
      <li>Khi nhập, chọn đúng tên từ danh sách gợi ý và điền các ô có dấu bắt buộc. Kiểm tra số lượng, đơn vị, ngày và tiền trước khi lưu.</li>
      <li>Bấm lưu một lần, chờ thông báo. Nếu có lỗi, đọc thông báo và sửa ô được chỉ ra trước khi thử lại.</li>
    </ol>
  </details>;
}

function CommonQuestions() {
  return <section aria-labelledby="guide-questions" className="space-y-3">
    <h2 id="guide-questions" className="text-lg font-semibold">Khi cần trợ giúp</h2>
    {[
      ["Không thấy một chức năng hoặc nút thao tác?", "Có thể tài khoản chưa được giao quyền hoặc chứng từ chưa ở bước phù hợp. Kiểm tra tình trạng chứng từ; nếu vẫn cần, liên hệ người quản lý."],
      ["Tìm không thấy đơn hoặc phiếu?", "Kiểm tra tên, mã, khoảng thời gian và các điều kiện đang lọc. Thử bỏ lọc rồi tìm lại."],
      ["Bấm lưu nhưng chưa rõ đã thành công chưa?", "Chờ thông báo, rồi tìm lại đơn hoặc phiếu trong danh sách trước khi tạo thêm để tránh trùng."],
      ["Thông báo vẫn chưa xử lý được?", "Ghi lại bạn đang làm gì, mã đơn hoặc phiếu và nội dung thông báo. Gửi thông tin đó cho người hỗ trợ; không gửi mật khẩu."],
    ].map(([title, body]) => <details key={title} className="rounded-md border border-border bg-surface p-4"><summary className={`min-h-11 cursor-pointer py-2 text-sm font-medium ${focus}`}>{title}</summary><p className="mt-2 text-sm leading-relaxed text-fg-secondary">{body}</p></details>)}
  </section>;
}

export function ModuleGuide({ module, topic }: { module: NavModule; topic?: string }) {
  const topics = guideTopics(module);
  // ASSUMPTION: link cũ hoặc chủ đề đã bị thu quyền trở về bài đầu còn được xem.
  const index = Math.max(0, topics.findIndex(({ fn }) => fn.key === topic));
  const current = topics[index];
  if (!current) return null;
  const { fn, article } = current;
  const topicLinks = topics.map(({ fn: item }, n) => <Link key={item.key} href={moduleGuideHref(module.key, item.key)} aria-current={fn.key === item.key ? "page" : undefined} className={`flex min-h-11 items-center gap-3 rounded-sm px-3 py-2 text-sm ${focus} ${fn.key === item.key ? "bg-accent-soft font-semibold text-accent" : "text-fg-secondary hover:bg-hover"}`}><span className="tabular-nums">{n + 1}.</span>{item.label}</Link>);
  return <div className="module-guide-page flex flex-col gap-4 lg:h-full lg:min-h-0">
    <GuideHeader title={`Hướng dẫn ${module.label}`} intro="Chọn việc cần làm và làm lần lượt theo các bước. Các mục hiển thị tùy quyền được giao cho tài khoản của bạn." />
    <Link href={`/m/${module.key}`} className={`${link} shrink-0 self-start`}><ArrowLeft size={16} aria-hidden />Quay lại {module.label}</Link>
    <details key={fn.key} className="rounded-md border border-border bg-surface p-3 lg:hidden"><summary className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-medium ${focus}`}><span>Bài {index + 1}: {fn.label} · Chọn bài khác</span><ChevronDown size={18} className="shrink-0" aria-hidden /></summary><nav aria-label="Chọn bài hướng dẫn" className="mt-3 space-y-1">{topicLinks}</nav></details>
    <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
      <nav aria-label={`Bài hướng dẫn ${module.label}`} className="hidden space-y-1 rounded-md border border-border bg-surface p-3 [scrollbar-color:var(--border-strong)_transparent] [scrollbar-width:thin] lg:block lg:w-56 lg:shrink-0 lg:overflow-y-auto">{topicLinks}</nav>
      <div className="guide-reading-panel flex min-w-0 flex-col rounded-md border border-border bg-surface lg:min-h-0 lg:flex-1">
        <article key={fn.key} aria-labelledby="guide-article-title" tabIndex={0} className={`space-y-6 p-4 [scrollbar-color:var(--border-strong)_transparent] [scrollbar-width:thin] md:p-6 lg:min-h-0 lg:flex-1 lg:overflow-y-auto ${focus}`}>
          <header className="space-y-2"><p className="text-sm text-fg-secondary">Bài {index + 1} / {topics.length}</p><h2 id="guide-article-title" className="text-lg font-semibold">{fn.label}</h2><p className="text-sm leading-relaxed">{article.when}</p></header>
          {article.prepare && <section className="space-y-2"><h3 className="font-semibold">Cần chuẩn bị</h3><p className="text-sm leading-relaxed">{article.prepare}</p></section>}
          <section className="space-y-3"><h3 className="font-semibold">Các bước thực hiện</h3><ol className="list-decimal space-y-4 pl-5 text-sm leading-relaxed marker:font-semibold marker:text-accent">{article.steps.map((step) => <li key={step} className="pl-2">{step}</li>)}</ol></section>
          <section className="space-y-2"><h3 className="font-semibold">Làm xong thì thấy gì?</h3><p className="text-sm leading-relaxed">{article.result}</p></section>
          {article.note && <aside className="space-y-2 rounded-sm border border-border bg-hover p-4"><h3 className="text-sm font-semibold">Lưu ý</h3><p className="text-sm leading-relaxed">{article.note}</p></aside>}
          <Link href={fn.path} className={`${link} bg-accent-soft`}><ArrowRight size={18} aria-hidden />Mở {fn.label}</Link>
        </article>
        <nav aria-label="Bài trước và bài tiếp theo" className="flex shrink-0 flex-wrap justify-between gap-3 border-t border-border p-3">
          {topics[index - 1] ? <Link href={moduleGuideHref(module.key, topics[index - 1]!.fn.key)} className={link}><ArrowLeft size={16} aria-hidden />{topics[index - 1]!.fn.label}</Link> : <span />}
          {topics[index + 1] && <Link href={moduleGuideHref(module.key, topics[index + 1]!.fn.key)} className={link}>{topics[index + 1]!.fn.label}<ArrowRight size={16} aria-hidden /></Link>}
        </nav>
      </div>
    </div>
  </div>;
}

export function RoleGuide({ role, nav }: { role: GuideRole; nav: NavModule[] }) {
  const tasks = roleTasks(role, nav);
  return <div className="space-y-6">
    <GuideHeader title={`Hướng dẫn dành cho ${role.label}`} intro={role.intro} backHref="/guide?view=roles" backLabel="Chọn công việc khác" />
    <p className="rounded-md border border-border bg-surface p-4 text-sm leading-relaxed">Làm theo thứ tự dưới đây khi có công việc tương ứng. Chỉ các phần tài khoản được phép sử dụng mới xuất hiện. Nếu cần làm việc chưa có trong danh sách, liên hệ người quản lý để kiểm tra quyền.</p>
    <ol className="space-y-3">{tasks.map((task, index) => <li key={task.fn}><Link href={task.href} className={card}><span className="flex items-center gap-3"><span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold tabular-nums text-accent">{index + 1}</span><span><span className="block text-sm font-semibold">{task.label}</span><span className="mt-1 block text-sm text-fg-secondary">{task.moduleLabel}</span></span></span><BookOpen size={20} className="shrink-0 text-accent" aria-hidden /></Link></li>)}</ol>
    {!tasks.length && <p className="text-sm text-fg-secondary">Tài khoản hiện chưa được giao các việc trong nhóm này. Bạn có thể chọn công việc khác hoặc liên hệ người quản lý.</p>}
    <Link href="/" className={link}><ArrowLeft size={16} aria-hidden />Trang chủ</Link>
  </div>;
}
