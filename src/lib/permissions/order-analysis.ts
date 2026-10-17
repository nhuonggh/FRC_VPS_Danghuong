import { redactDeep } from "./redact";
export const canViewOrderAnalysis = (perms: ReadonlySet<string>) => perms.has("order.analysis.view");
/** Sales-only gate; accountants retain purchasing permissions elsewhere. */
export function orderDisclosurePermissions(perms: ReadonlySet<string>): ReadonlySet<string> {
  if (canViewOrderAnalysis(perms)) return perms;
  return new Set([...perms].filter(p => !["cost.view", "profit.view", "purchase_price.view"].includes(p)));
}
const INTERNAL_FIELDS = new Set(["issues", "bomVersionId", "bomVersionLabel", "bomSnapshot", "costReference"]);
export function redactOrderData<T>(value: T, perms: ReadonlySet<string>): T {
  const redacted = redactDeep(value, orderDisclosurePermissions(perms));
  if (canViewOrderAnalysis(perms)) return redacted;
  function strip(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).filter(([k]) => !INTERNAL_FIELDS.has(k)).map(([k, val]) => [k, strip(val)]));
    return v;
  }
  return strip(redacted) as T;
}
