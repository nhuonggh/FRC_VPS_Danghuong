import type { NavModule } from "@/config/app.config";
import { APP_NAME } from "@/lib/version";
import { Breadcrumb } from "./Breadcrumb";
import { FavoritesMenu } from "./FavoritesMenu";
import { QuickAccess } from "./QuickAccess";
import { ThemeSwitch } from "./ThemeSwitch";
import { UserMenu } from "./UserMenu";
import { SupplierOrderBell } from "@/components/purchase/SupplierOrderBell";

export function Header({ nav, user }: { nav: NavModule[]; user: { fullName: string; username: string } }) {
  return (
    <header className="sticky top-0 z-header flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-3 lg:px-6">
      <div className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-semibold md:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={24} height={24} className="size-6" />
          {APP_NAME}
        </span>
        <div className="hidden md:block"><Breadcrumb nav={nav} /></div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        {nav.some(module => module.categories.some(category => category.functions.some(fn => fn.key === "supplier-orders"))) && <SupplierOrderBell />}
        <FavoritesMenu nav={nav} />
        <QuickAccess nav={nav} />
        <ThemeSwitch />
        <UserMenu fullName={user.fullName} username={user.username} />
      </div>
    </header>
  );
}
