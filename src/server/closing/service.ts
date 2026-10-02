import type { PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { closeOpenPeriod, type ClosePeriodInput, type ClosePeriodResult } from "@/server/period/close";

/** Kết sổ kỳ đang mở + nhật ký thao tác (audit cùng transaction: kết sổ hoàn tác thì audit cũng không còn). */
export function closePeriod(prisma: PrismaClient, actor: Actor, input: Omit<ClosePeriodInput, "afterClose"> = {}): Promise<ClosePeriodResult> {
  return closeOpenPeriod(prisma, actor, {
    ...input,
    afterClose: (tx, info) => writeAudit(tx, {
      userId: actor.userId, action: "period.close", entity: "Period", entityId: info.closed.id,
      before: { status: "OPEN", name: info.closed.name },
      after: { status: "CLOSED", newPeriodId: info.newPeriod.id, newPeriodName: info.newPeriod.name, ...info.carried, warningCount: info.warningCount },
    }),
  });
}
