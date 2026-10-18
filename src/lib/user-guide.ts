import type { NavModule } from "@/config/app.config";
import { GUIDE_ARTICLES, GUIDE_ROLES, type GuideRole } from "@/config/user-guide";
import { moduleGuideHref } from "./guide-links";

/** Chỉ nhận menu đã lọc quyền. Nội dung không tạo quyền hay mở đường dẫn tới chức năng bị ẩn. */
export function guideTopics(module: NavModule) {
  return module.categories.flatMap((c) => c.functions)
    .filter((fn) => !fn.planned && GUIDE_ARTICLES[fn.key])
    .map((fn) => ({ fn, article: GUIDE_ARTICLES[fn.key]! }));
}

export function roleTasks(role: GuideRole, nav: readonly NavModule[]) {
  const available = nav.flatMap((module) => guideTopics(module).map(({ fn }) => ({ module, fn })));
  return role.tasks.flatMap((task) => {
    const hit = available.find(({ fn }) => fn.key === task.fn);
    return hit ? [{ ...task, href: moduleGuideHref(hit.module.key, hit.fn.key), moduleLabel: hit.module.label }] : [];
  });
}

export function visibleGuideRoles(nav: readonly NavModule[]) {
  return GUIDE_ROLES.filter((role) => roleTasks(role, nav).length > 0);
}
