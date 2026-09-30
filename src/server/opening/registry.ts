import type { Actor } from "@/lib/permissions/scope";
import { DomainError } from "@/server/http/errors";
import type { ImportSpec } from "@/server/import/types";
import { openingMoneySpec } from "./money";
import { openingStockSpec } from "./stock";

export const OPENING_KINDS = ["stock", "material", "debt", "cash", "discount"] as const;
export type OpeningKind = (typeof OPENING_KINDS)[number];
export const OPENING_TITLE: Record<OpeningKind, string> = { stock: "Tồn kho đầu kỳ", material: "Tồn NVL đầu kỳ", debt: "Công nợ đầu kỳ", cash: "Số dư quỹ đầu kỳ", discount: "Chiết khấu tích lũy đầu kỳ" };

export function parseOpeningKind(raw: string): OpeningKind {
  if ((OPENING_KINDS as readonly string[]).includes(raw)) return raw as OpeningKind;
  throw new DomainError("Không tìm thấy loại số đầu kỳ.", 404);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function openingSpec(kind: OpeningKind, opts: { actor: Actor; force: boolean }): ImportSpec<any, any> {
  return kind === "stock" || kind === "material" ? openingStockSpec(kind, opts) : openingMoneySpec(kind, opts);
}
