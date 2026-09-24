import type { NavModule } from "@/config/app.config";
import { APP_NAME } from "@/lib/version";
import { Breadcrumb } from "./Breadcrumb";
import { ThemeSwitch } from "./ThemeSwitch";
import { UserMenu } from "./UserMenu";

export function Header({ nav, user }: { nav: NavModule[]; user: { fullName: string; username: string } }) {
  return (
    <header className="sticky top-0 z-header flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-3 lg:px-6">
      <div className="min-w-0">
        <span className="text-sm font-semibold md:hidden">{APP_NAME}</span>
        <div className="hidden md:block"><Breadcrumb nav={nav} /></div>
      </div>
      <div className="flex items-center gap-3">
        <ThemeSwitch />
        <UserMenu fullName={user.fullName} username={user.username} />
      </div>
    </header>
  );
}
