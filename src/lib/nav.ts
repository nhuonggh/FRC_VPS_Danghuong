import type { NavCategory, NavFunction, NavModule } from "@/config/app.config";
import { GUIDE_ROLES } from "@/config/guide-roles";

/** Lọc menu theo quyền: ẩn HẲN (không hiện xám) — global-rules.md mục 8. */
export function buildNav(nav: readonly NavModule[], perms: ReadonlySet<string>): NavModule[] {
  const allowed = (perm?: string) => !perm || perms.has(perm);
  return nav
    .filter((m) => allowed(m.perm))
    .map((m) => ({
      ...m,
      categories: m.categories
        .map((c) => ({ ...c, functions: c.functions.filter((f) => !f.planned && allowed(f.perm)) }))
        .filter((c) => c.functions.length > 0),
    }))
    .filter((m) => m.type === "flat" || m.categories.length > 0);
}

export interface ActiveMatch {
  module: NavModule;
  category: NavCategory;
  fn: NavFunction;
}

const matches = (pathname: string, path: string) =>
  pathname === path || pathname.startsWith(path + "/");

/** Chức năng có path là tiền tố DÀI NHẤT của pathname (để /a/deleted thắng /a). */
export function findActiveFunction(nav: readonly NavModule[], pathname: string): ActiveMatch | null {
  let best: ActiveMatch | null = null;
  for (const mod of nav) {
    for (const category of mod.categories) {
      for (const fn of category.functions) {
        if (matches(pathname, fn.path) && (!best || fn.path.length > best.fn.path.length)) {
          best = { module: mod, category, fn };
        }
      }
    }
  }
  return best;
}

export interface Crumb {
  label: string;
  href?: string;
}

export function resolveBreadcrumb(nav: readonly NavModule[], pathname: string): Crumb[] {
  if (pathname === "/") return [{ label: "Trang chủ" }];
  if (pathname === "/guide") return [{ label: "Trang chủ", href: "/" }, { label: "Hướng dẫn sử dụng" }];
  const moduleGuide = /^\/guide\/modules\/([^/]+)\/?$/.exec(pathname);
  if (moduleGuide) {
    const navModule = nav.find((m) => m.key === moduleGuide[1]);
    return navModule ? [{ label: navModule.label, href: `/m/${navModule.key}` }, { label: "Hướng dẫn sử dụng" }] : [];
  }
  const roleGuide = /^\/guide\/roles\/([^/]+)\/?$/.exec(pathname);
  if (roleGuide) {
    const role = GUIDE_ROLES.find((r) => r.key === roleGuide[1]);
    return role ? [{ label: "Hướng dẫn sử dụng", href: "/guide?view=roles" }, { label: role.label }] : [];
  }
  const hit = findActiveFunction(nav, pathname);
  if (!hit) return [];
  const rest = pathname.slice(hit.fn.path.length).split("/").filter(Boolean);
  const crumbs: Crumb[] = [{ label: hit.module.label, href: `/m/${hit.module.key}` }];
  if (rest.length === 0) {
    crumbs.push({ label: hit.fn.label });
    return crumbs;
  }
  crumbs.push({ label: hit.fn.label, href: hit.fn.path });
  crumbs.push({ label: rest[0] === "new" ? "Thêm mới" : "Chi tiết" });
  return crumbs;
}
