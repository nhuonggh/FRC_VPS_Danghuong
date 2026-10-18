import Link from "next/link";
import { BookOpen, ArrowRight, Users } from "lucide-react";

const link = "flex min-h-11 items-center justify-between gap-3 rounded-md border border-border bg-surface p-4 text-sm font-medium hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

export function GuideHomeSection() {
  return (
    <section aria-labelledby="home-guide-title" className="space-y-3 border-t border-border pt-6">
      <div>
        <h2 id="home-guide-title" className="flex items-center gap-2 text-lg font-semibold"><BookOpen size={20} aria-hidden />Hướng dẫn sử dụng</h2>
        <p className="mt-2 text-sm text-fg-secondary">Chọn phần bạn cần làm. Mỗi bài hướng dẫn từng bước để bạn làm theo.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Link href="/guide" className={link}><span className="flex items-center gap-3"><BookOpen size={20} aria-hidden />Theo chức năng</span><ArrowRight size={18} aria-hidden /></Link>
        <Link href="/guide?view=roles" className={link}><span className="flex items-center gap-3"><Users size={20} aria-hidden />Theo công việc của bạn</span><ArrowRight size={18} aria-hidden /></Link>
      </div>
    </section>
  );
}
