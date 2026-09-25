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

/** Không ghi chứng từ có ngày (theo ICT) trước ngày mở kỳ hiện tại. */
export function assertDocDateInPeriod(period: PeriodRef, at: Date): void {
  const o = toIct(period.openedAt);
  if (at < ictStartOfDay(o.y, o.m, o.d)) throw new DocDateBeforePeriodError();
}
