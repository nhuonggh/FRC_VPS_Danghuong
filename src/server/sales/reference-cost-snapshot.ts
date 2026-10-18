import { Prisma } from "@prisma/client";
import { costReference, type IssueMode } from "./cost-reference";
import { dateOnly } from "@/server/bom/resolve";
import { ictYmd } from "@/lib/time";

/** Chụp ở server trong giao dịch lưu đơn. Không nhận dữ liệu giá từ client, không ghi sổ. */
export async function referenceCostSnapshot(tx: Prisma.TransactionClient, productId: number, processingTypeId: number | null, at: Date, mode: IssueMode) {
  if (!processingTypeId || mode === "STOCK") return Prisma.JsonNull;
  // Chỉ tính bản chụp khi đã có cấu hình mới. Quyền của người xem vẫn kiểm lại lúc xuất DTO.
  const configured = await tx.referenceCostPlan.count({ where: { processingTypeId, OR: [{ productId }, { productId: null }], validFrom: { lte: dateOnly(ictYmd(at)) } } });
  if (!configured) return Prisma.JsonNull;
  const ref = await costReference(tx, { userId: 0, perms: new Set(["order.analysis.view", "cost.view", "purchase_price.view"]) }, productId, processingTypeId, at, mode);
  return ref ? JSON.parse(JSON.stringify(ref)) as Prisma.InputJsonValue : Prisma.JsonNull;
}
