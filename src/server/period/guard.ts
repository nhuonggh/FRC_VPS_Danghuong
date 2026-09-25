import type { PrismaClient } from "@prisma/client";
import { ictStartOfDay, toIct } from "@/lib/time";
import { DomainError } from "@/server/http/errors";
import { DocDateBeforePeriodError, PeriodClosedError } from "@/server/inventory/errors";
import type { Tx } from "@/server/inventory/types";

export interface PeriodRef {
  id: number;
  openedAt: Date;
}

/** Kỳ đang mở duy nhất (luôn có đúng 1 — ràng buộc DB). */
export async function getOpenPeriod(db: Tx | PrismaClient): Promise<PeriodRef> {
  const p = await db.period.findFirst({ where: { isOpen: true }, select: { id: true, openedAt: true } });
  if (!p) throw new DomainError("Hệ thống chưa có kỳ đang mở.", 500, "NO_OPEN_PERIOD");
  return p;
}

/** Chứng từ chỉ sửa/hủy được khi kỳ của nó còn MỞ. */
export async function assertPeriodOpen(db: Tx | PrismaClient, periodId: number): Promise<PeriodRef> {
  const p = await db.period.findFirst({ where: { id: periodId, isOpen: true }, select: { id: true, openedAt: true } });
  if (!p) throw new PeriodClosedError();
  return p;
}

/**
 * Cho ENGINE (beginEngine): như getOpenPeriod / assertPeriodOpen nhưng giữ `FOR SHARE` trên dòng `periods` tới hết
 * transaction (review I2). Kết sổ (plan 07-F1) lấy `FOR UPDATE` trên cùng dòng ⇒ hai bên TUẦN TỰ: giao dịch kho đang chạy
 * làm kết sổ chờ; giao dịch kho đến sau khi kết sổ đã khoá thì chờ, rồi (READ COMMITTED đánh giá lại dòng mới nhất) thấy
 * kỳ đã đóng ⇒ PeriodClosedError. Phải gọi TRƯỚC mọi khoá advisory mã hàng (thứ tự khoá cố định: kỳ → mã hàng) — kết sổ
 * cũng khoá kỳ trước tiên, nên không có chu trình chờ giữa hai bên.
 * Không truyền `periodId` (= kỳ đang mở): tra id kỳ mở rồi khoá theo id; nếu trong lúc chờ khoá kỳ đó bị đóng (và kỳ mới
 * được mở) thì tra lại — mỗi câu lệnh READ COMMITTED thấy dữ liệu đã commit mới nhất.
 */
export async function lockPeriodForEngine(tx: Tx, periodId?: number): Promise<PeriodRef> {
  for (let attempt = 0; ; attempt++) {
    const id = periodId ?? (await getOpenPeriod(tx)).id;
    const rows = await tx.$queryRaw<{ id: number; openedAt: Date; isOpen: boolean | null }[]>`
      SELECT id, "openedAt", "isOpen" FROM periods WHERE id = ${id} FOR SHARE`;
    const p = rows[0];
    if (p?.isOpen) return { id: p.id, openedAt: p.openedAt };
    if (periodId !== undefined || attempt >= 2) throw new PeriodClosedError();
  }
}

/** Không ghi chứng từ có ngày (theo ICT) trước ngày mở kỳ hiện tại. */
export function assertDocDateInPeriod(period: PeriodRef, at: Date): void {
  const o = toIct(period.openedAt);
  if (at < ictStartOfDay(o.y, o.m, o.d)) throw new DocDateBeforePeriodError();
}
