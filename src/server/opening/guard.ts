import type { Prisma, PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { DomainError } from "@/server/http/errors";
import { getOpenPeriod } from "@/server/period/guard";

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * D-39: số đầu kỳ chỉ nhập khi kỳ đang mở CHƯA có chứng từ nào. Người có `period.close` (giám đốc) được ép qua bằng
 * cờ `force` (khởi tạo/sửa lại số đầu kỳ có chủ ý). Trả kỳ đang mở để bên gọi dùng.
 */
export async function assertOpeningAllowed(db: Db, actor: Actor, force: boolean) {
  const period = await getOpenPeriod(db);
  if (force) {
    if (!actor.perms.has("period.close")) throw new DomainError("Chỉ giám đốc mới được nhập số đầu kỳ khi kỳ đã có chứng từ.", 403, "FORBIDDEN");
    return period;
  }
  const where = { periodId: period.id };
  const [stock, partner, cash, orders, purchases] = await Promise.all([
    db.stockLedger.count({ where: { ...where, NOT: { docType: "OPENING" } } }),
    db.partnerLedger.count({ where }), db.cashLedger.count({ where }),
    db.saleOrder.count({ where }), db.purchase.count({ where }),
  ]);
  if (stock + partner + cash + orders + purchases > 0) {
    throw new DomainError("Kỳ đang mở đã có chứng từ (đơn, phiếu nhập, sổ kho, công nợ hoặc quỹ) nên không nhập số đầu kỳ được. Giám đốc có thể chọn “Cho phép khi kỳ đã có chứng từ”.", 409, "OPENING_PERIOD_HAS_DOCS");
  }
  return period;
}
