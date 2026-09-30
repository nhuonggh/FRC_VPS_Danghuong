import { DomainError } from "@/server/http/errors";
import type { VoucherDoc } from "./schemas";

/** URL public dùng số nhiều (`receipts`/`payments`), server dùng RECEIPT/PAYMENT. */
export function parseVoucherKind(raw: string): VoucherDoc {
  if (raw === "receipts") return "RECEIPT";
  if (raw === "payments") return "PAYMENT";
  throw new DomainError("Không tìm thấy loại phiếu.", 404);
}
export const voucherPerm = (doc: VoucherDoc) => (doc === "RECEIPT" ? "receipt.manage" : "payment.manage") as "receipt.manage" | "payment.manage";
