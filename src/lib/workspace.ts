import { z } from "zod";
import type { NavFunction, NavModule } from "@/config/app.config";
import { findActiveFunction } from "@/lib/nav";

/**
 * Không gian làm việc theo tài khoản: tab yêu thích (ghim) của từng module + trạng thái sidebar.
 * Logic THUẦN (không React/DB) để client và server dùng chung. KHÔNG lưu dữ liệu nghiệp vụ/bí mật.
 */
export const MAX_PINS = 40;
export const MAX_QUICK = 24;
/** Truy cập nhanh mặc định (chức năng hay dùng theo thứ tự); chỉ hiện nếu còn trong menu đã lọc quyền. */
export const DEFAULT_QUICK_KEYS = ["purchase-new", "purchase-list", "stock-onhand", "stock-min", "product-list", "bom-list", "company"] as const;
const KEY = /^[a-z0-9][a-z0-9-]*$/;
const keySchema = z.string().max(60).regex(KEY);
export const prefsSchema = z.object({
  v: z.literal(1),
  sidebarCollapsed: z.boolean().optional(),
  /** Truy cập nhanh (nút trên header): khoá chức năng theo thứ tự. Chưa tuỳ chỉnh (undefined) ⇒ dùng mặc định DEFAULT_QUICK_KEYS. */
  quickAccess: z.array(keySchema).max(24).optional(),
  modules: z.record(keySchema, z.object({ pinned: z.array(keySchema).max(MAX_PINS), active: keySchema.optional() })).refine((m) => Object.keys(m).length <= 40, "Quá nhiều module."),
});
export type Prefs = z.infer<typeof prefsSchema>;
export const emptyPrefs = (): Prefs => ({ v: 1, modules: {} });
/** Dữ liệu lưu hỏng/cũ ⇒ về mặc định, không bao giờ làm hỏng giao diện. */
export function parsePrefs(raw: unknown): Prefs { const r = prefsSchema.safeParse(raw); return r.success ? r.data : emptyPrefs(); }

const pinsOf = (p: Prefs, m: string) => p.modules[m]?.pinned ?? [];
const withModule = (p: Prefs, m: string, patch: Partial<Prefs["modules"][string]>): Prefs => ({ ...p, modules: { ...p.modules, [m]: { ...p.modules[m], pinned: pinsOf(p, m), ...patch } } });

/** Ghim/bỏ ghim một chức năng của module. Ghim mới thêm vào cuối. */
export function togglePin(p: Prefs, moduleKey: string, fnKey: string): Prefs {
  const pins = pinsOf(p, moduleKey);
  if (pins.includes(fnKey)) return withModule(p, moduleKey, { pinned: pins.filter((k) => k !== fnKey) });
  return pins.length >= MAX_PINS ? p : withModule(p, moduleKey, { pinned: [...pins, fnKey] });
}
/** Sắp xếp lại các tab ghim: `order` là thứ tự mới của (một phần) các khoá đã ghim; khoá lạ bị bỏ, khoá thiếu giữ ở cuối. */
export function reorderPins(p: Prefs, moduleKey: string, order: readonly string[]): Prefs {
  const pins = pinsOf(p, moduleKey); const next = [...order.filter((k, i) => pins.includes(k) && order.indexOf(k) === i), ...pins.filter((k) => !order.includes(k))];
  return withModule(p, moduleKey, { pinned: next });
}
export function setActive(p: Prefs, moduleKey: string, fnKey: string | undefined): Prefs {
  if (p.modules[moduleKey]?.active === fnKey) return p;
  if (fnKey !== undefined) return withModule(p, moduleKey, { active: fnKey });
  const { active: _drop, ...rest } = { ...p.modules[moduleKey], pinned: pinsOf(p, moduleKey) }; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...p, modules: { ...p.modules, [moduleKey]: rest } };
}
export const setSidebarCollapsed = (p: Prefs, collapsed: boolean): Prefs => (p.sidebarCollapsed === collapsed ? p : { ...p, sidebarCollapsed: collapsed });

const fnsOf = (m: NavModule) => m.categories.flatMap((c) => c.functions);
/** Module (dạng accordion) mà đường dẫn hiện tại thuộc về: `/m/<key>` hoặc theo chức năng đang mở. */
export function moduleForPath(nav: readonly NavModule[], pathname: string): { module: NavModule; fn: NavFunction | null } | null {
  const landing = /^\/m\/([^/]+)\/?$/.exec(pathname);
  if (landing) { const found = nav.find((m) => m.key === landing[1] && m.type === "accordion"); return found ? { module: found, fn: null } : null; }
  const guide = /^\/guide\/modules\/([^/]+)\/?$/.exec(pathname);
  if (guide) { const found = nav.find((m) => m.key === guide[1] && m.type === "accordion"); return found ? { module: found, fn: null } : null; }
  const hit = findActiveFunction(nav, pathname);
  return hit && hit.module.type === "accordion" ? { module: hit.module, fn: hit.fn } : null;
}

export interface WorkspaceTab { key: string; label: string; href: string; kind: "functions" | "pinned" | "temp"; icon?: string }
export const FUNCTIONS_TAB = "__functions";
/**
 * Bộ tab của một module: "Chức năng" (cố định, luôn đầu) + tab đã ghim (đúng thứ tự, chỉ chức năng còn tồn tại VÀ có quyền —
 * `module` đã được lọc quyền bởi buildNav) + tối đa MỘT tab tạm thời (chức năng đang mở mà chưa ghim).
 */
export function tabsFor(module: NavModule, prefs: Prefs, activeFnKey: string | null): WorkspaceTab[] {
  const byKey = new Map(fnsOf(module).map((f) => [f.key, f]));
  const tabs: WorkspaceTab[] = [{ key: FUNCTIONS_TAB, label: "Chức năng", href: `/m/${module.key}`, kind: "functions" }];
  const pins = pinsOf(prefs, module.key).filter((k) => byKey.has(k));
  for (const k of pins) { const f = byKey.get(k)!; tabs.push({ key: k, label: f.label, href: f.path, kind: "pinned", icon: f.icon }); }
  if (activeFnKey && byKey.has(activeFnKey) && !pins.includes(activeFnKey)) { const f = byKey.get(activeFnKey)!; tabs.push({ key: f.key, label: f.label, href: f.path, kind: "temp", icon: f.icon }); }
  return tabs;
}
/** Về module: mở lại chức năng đang làm dở nếu còn hợp lệ (còn tồn tại + có quyền), ngược lại trang "Chức năng". */
export function restoreHref(module: NavModule, prefs: Prefs): string {
  const active = prefs.modules[module.key]?.active; const fn = active ? fnsOf(module).find((f) => f.key === active) : undefined;
  return fn ? fn.path : `/m/${module.key}`;
}
/** Yêu thích toàn hệ thống: mọi chức năng đã ghim ở các module (chỉ cái còn hợp lệ), theo thứ tự module rồi thứ tự ghim. */
export function allPinned(nav: readonly NavModule[], prefs: Prefs): { module: NavModule; fn: NavFunction }[] {
  return nav.filter((m) => m.type === "accordion").flatMap((m) => { const byKey = new Map(fnsOf(m).map((f) => [f.key, f])); return pinsOf(prefs, m.key).flatMap((k) => (byKey.has(k) ? [{ module: m, fn: byKey.get(k)! }] : [])); });
}
export const isPinned = (p: Prefs, moduleKey: string, fnKey: string) => pinsOf(p, moduleKey).includes(fnKey);

// ---- Truy cập nhanh (yêu thích toàn hệ thống, mở từ nút trên header) ----
export const quickKeys = (p: Prefs): readonly string[] => p.quickAccess ?? DEFAULT_QUICK_KEYS;
export const isQuick = (p: Prefs, fnKey: string) => quickKeys(p).includes(fnKey);
/** Mọi chức năng đang có trong menu (đã lọc quyền, không planned) — dùng cho danh sách "Thêm chức năng". */
export function allFunctions(nav: readonly NavModule[]): { module: NavModule; fn: NavFunction }[] {
  return nav.flatMap((m) => fnsOf(m).map((fn) => ({ module: m, fn })));
}
/** Danh sách truy cập nhanh đã giải: đúng thứ tự, chỉ chức năng còn tồn tại VÀ đủ quyền (không bao giờ trỏ tới màn chưa giao). */
export function resolveQuick(nav: readonly NavModule[], p: Prefs): { module: NavModule; fn: NavFunction }[] {
  const byKey = new Map(allFunctions(nav).map((x) => [x.fn.key, x]));
  return quickKeys(p).flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : []));
}
/** Thêm/bỏ một chức năng khỏi truy cập nhanh. Lần sửa đầu tiên "chốt" danh sách mặc định rồi mới sửa trên đó. */
export function toggleQuick(p: Prefs, fnKey: string): Prefs {
  const cur = [...quickKeys(p)];
  if (cur.includes(fnKey)) return { ...p, quickAccess: cur.filter((k) => k !== fnKey) };
  return cur.length >= MAX_QUICK ? p : { ...p, quickAccess: [...cur, fnKey] };
}
/** Đổi vị trí một mục (delta -1 = lên, +1 = xuống) trong danh sách nhìn thấy; khoá không còn hợp lệ không bị đụng tới. */
export function moveQuick(p: Prefs, fnKey: string, delta: -1 | 1): Prefs {
  const cur = [...quickKeys(p)]; const at = cur.indexOf(fnKey); const to = at + delta;
  if (at < 0 || to < 0 || to >= cur.length) return p;
  [cur[at], cur[to]] = [cur[to]!, cur[at]!];
  return { ...p, quickAccess: cur };
}
/** Khôi phục danh sách mặc định. */
export function resetQuick(p: Prefs): Prefs { const { quickAccess: _drop, ...rest } = p; return rest; } // eslint-disable-line @typescript-eslint/no-unused-vars
