import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import { DomainError, ValidationError } from "@/server/http/errors";
import { closeOpenPeriod, previewClosing, type ClosePeriodInput, type ClosePeriodResult, type ClosePreview } from "@/server/period/close";
import { getCloseChecklist } from "@/server/period/close-checklist";

/** Bản sao lưu phải mới hơn từng này (spec Plan 07 F1c: backup < 24 giờ trước khi kết). */
export const BACKUP_MAX_AGE_MS = 24 * 3600 * 1000;
/** Cho lệch đồng hồ máy người dùng so với máy chủ. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Kết sổ kỳ đang mở + nhật ký thao tác (audit cùng transaction: kết sổ hoàn tác thì audit cũng không còn). */
export function closePeriod(
  prisma: PrismaClient, actor: Actor, input: Omit<ClosePeriodInput, "afterClose"> & { auditExtra?: Record<string, unknown> } = {},
): Promise<ClosePeriodResult> {
  const { auditExtra, ...rest } = input;
  return closeOpenPeriod(prisma, actor, {
    ...rest,
    afterClose: (tx, info) => writeAudit(tx, {
      userId: actor.userId, action: "period.close", entity: "Period", entityId: info.closed.id,
      before: { status: "OPEN", name: info.closed.name },
      after: { status: "CLOSED", newPeriodId: info.newPeriod.id, newPeriodName: info.newPeriod.name, ...info.carried, warningCount: info.warningCount, ...auditExtra },
    }),
  });
}

/** Bước 2 của xác nhận: gõ lại ĐÚNG tên kỳ + khai giờ sao lưu + tick xác nhận. */
export const confirmCloseSchema = z.object({
  confirmName: z.string().trim().min(1, "Gõ lại tên kỳ để xác nhận."),
  backupAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Nhập thời điểm sao lưu gần nhất."),
  acknowledged: z.literal(true, { errorMap: () => ({ message: "Tick xác nhận đã hiểu kết sổ không hoàn tác được." }) }),
  newName: z.string().trim().max(60, "Tên kỳ mới tối đa 60 ký tự.").optional(),
});
export type ConfirmCloseInput = z.infer<typeof confirmCloseSchema>;

export interface ClosePreviewData {
  period: { id: number; name: string };
  blockerCount: number;
  warningCount: number;
  preview: ClosePreview;
}

/** Bước 1: xem trước số cuối kỳ → số đầu kỳ mới. Chỉ đọc, không khoá. */
export async function previewClose(prisma: PrismaClient, actor: Actor): Promise<ClosePreviewData> {
  assertCan(actor.perms, "period.close");
  const checklist = await getCloseChecklist(prisma);
  return { period: { id: checklist.period.id, name: checklist.period.name }, blockerCount: checklist.blockerCount, warningCount: checklist.warningCount, preview: await previewClosing(prisma, checklist.period.id) };
}

/**
 * Bước 2: kiểm tên kỳ khớp + sao lưu còn mới rồi mới kết sổ. Chống bấm đôi/hai người cùng lúc do engine (khoá `FOR UPDATE`
 * dòng kỳ): lần đến sau thấy kỳ đã đóng ⇒ 409 PERIOD_ALREADY_CLOSED. Giờ sao lưu do Giám đốc khai (app chạy trong
 * container không chạy được `backup.sh` của VPS) và được ghi vào nhật ký thao tác cùng lần kết sổ.
 */
export async function confirmClose(prisma: PrismaClient, actor: Actor, raw: ConfirmCloseInput, now: Date = new Date()): Promise<ClosePeriodResult> {
  assertCan(actor.perms, "period.close");
  const input = confirmCloseSchema.parse(raw);
  const open = await prisma.period.findFirst({ where: { isOpen: true }, select: { name: true } });
  if (!open) throw new DomainError("Kỳ này đã được kết sổ (hoặc chưa có kỳ đang mở).", 409, "PERIOD_ALREADY_CLOSED");
  if (input.confirmName !== open.name) throw new ValidationError("Tên kỳ gõ lại không khớp.", { confirmName: `Gõ đúng "${open.name}".` });
  const backupAt = new Date(input.backupAt);
  if (backupAt.getTime() > now.getTime() + CLOCK_SKEW_MS) throw new ValidationError("Thời điểm sao lưu ở tương lai.", { backupAt: "Thời điểm sao lưu không được ở tương lai." });
  if (now.getTime() - backupAt.getTime() > BACKUP_MAX_AGE_MS) {
    throw new ValidationError("Bản sao lưu đã quá 24 giờ.", { backupAt: "Sao lưu lại DB (RUNBOOK mục 14) rồi nhập giờ mới — bản sao lưu phải trong 24 giờ qua." });
  }
  return closePeriod(prisma, actor, { now, ...(input.newName ? { newName: input.newName } : {}), auditExtra: { confirmedName: input.confirmName, backupAt: backupAt.toISOString() } });
}
