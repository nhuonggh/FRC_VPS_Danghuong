import { DomainError } from "@/server/http/errors";
import type { PartnerKind } from "./codes";

/** URL public dùng số nhiều, server dùng PartnerKind số ít. */
export function parseKindParam(raw: string): PartnerKind {
  if (raw === "customers") return "customer";
  if (raw === "suppliers") return "supplier";
  throw new DomainError("Không tìm thấy danh sách.", 404);
}
