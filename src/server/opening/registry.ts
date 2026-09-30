import type { Actor } from "@/lib/permissions/scope";
import type { ImportSpec } from "@/server/import/types";
import { openingMoneySpec } from "./money";
import { openingStockSpec } from "./stock";

import type { OpeningKind } from "./kinds";
export { OPENING_KINDS, OPENING_TITLE, parseOpeningKind, type OpeningKind } from "./kinds";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function openingSpec(kind: OpeningKind, opts: { actor: Actor; force: boolean }): ImportSpec<any, any> {
  return kind === "stock" || kind === "material" ? openingStockSpec(kind, opts) : openingMoneySpec(kind, opts);
}
