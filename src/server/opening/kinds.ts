import { DomainError } from "@/server/http/errors";

export const OPENING_KINDS = ["stock", "material", "debt", "cash", "discount"] as const;
export type OpeningKind = (typeof OPENING_KINDS)[number];
export const OPENING_TITLE: Record<OpeningKind, string> = { stock: "Tồn kho đầu kỳ", material: "Tồn NVL đầu kỳ", debt: "Công nợ đầu kỳ", cash: "Số dư quỹ đầu kỳ", discount: "Chiết khấu tích lũy đầu kỳ" };

export function parseOpeningKind(raw: string): OpeningKind {
  if ((OPENING_KINDS as readonly string[]).includes(raw)) return raw as OpeningKind;
  throw new DomainError("Không tìm thấy loại số đầu kỳ.", 404);
}
