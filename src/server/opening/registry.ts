import type { Actor } from "@/lib/permissions/scope";
import type { ImportSpec } from "@/server/import/types";
import { openingLegacyStockSpec } from "./legacy-stock";
import { openingMoneySpec } from "./money";
import { openingStockSpec } from "./stock";

import type { OpeningKind } from "./kinds";
export { OPENING_KINDS, OPENING_TITLE, parseOpeningKind, type OpeningKind } from "./kinds";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function openingSpec(kind: OpeningKind, opts: { actor: Actor; force: boolean; legacy?: { updateMinStock: boolean } }): ImportSpec<any, any> {
  if (kind !== "stock" && kind !== "material") return openingMoneySpec(kind, opts);
  return opts.legacy ? openingLegacyStockSpec(kind, { ...opts, updateMinStock: opts.legacy.updateMinStock }) : openingStockSpec(kind, opts);
}
/** `?legacy=1` = tệp "Định mức tồn" của phần mềm cũ (chỉ màn tồn kho / NVL); `&minStock=1` = cập nhật luôn Định mức tồn. */
export function legacyOptions(url: string, kind: OpeningKind): { updateMinStock: boolean } | undefined {
  const q = new URL(url).searchParams;
  return q.get("legacy") === "1" && (kind === "stock" || kind === "material") ? { updateMinStock: q.get("minStock") === "1" } : undefined;
}
