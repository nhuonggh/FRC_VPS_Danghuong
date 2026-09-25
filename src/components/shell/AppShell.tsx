import type { NavModule } from "@/config/app.config";
import { BottomNav } from "./BottomNav";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { OfflineBanner } from "./OfflineBanner";
import { Sidebar } from "./Sidebar";

export function AppShell({
  nav, user, children,
}: { nav: NavModule[]; user: { fullName: string; username: string }; children: React.ReactNode }) {
  return (
    <div className="flex h-dvh bg-canvas text-fg">
      <Sidebar nav={nav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header nav={nav} user={user} />
        <OfflineBanner />
        {/* Vùng cuộn DUY NHẤT của trang. Padding ngang cố định theo breakpoint (theming.md mục 1). */}
        <main className="app-shell-main min-h-0 flex-1 overflow-y-auto px-3 pb-20 pt-4 md:px-4 md:pb-4 lg:px-5 xl:px-6">
          {children}
        </main>
        <Footer />
      </div>
      <BottomNav nav={nav} />
    </div>
  );
}
