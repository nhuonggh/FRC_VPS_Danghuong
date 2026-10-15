import type { DailyReview, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { parseYmd, type TimeRange } from "@/lib/time-presets";
import { ictYmd } from "@/lib/time";
import { parseListParams, type ListParams } from "@/lib/query-params";
import type { Actor } from "@/lib/permissions/scope";
import { DomainError } from "@/server/http/errors";
import { writeAudit } from "@/server/audit/write";
import { loadDailyItem, requireDailyItem } from "./daily";

export const reviewSchema = z.object({
  day: z.string().refine((s) => !!parseYmd(s), "Ngày kiểm tra không hợp lệ."),
  itemKey: z.string().min(1).max(40),
  action: z.enum(["seen", "check", "uncheck"]),
  expectedVersion: z.string().regex(/^[a-f0-9]{32}$/, "Phiên bản dữ liệu không hợp lệ."),
}).strict();
export type ReviewInput = z.infer<typeof reviewSchema>;
export interface ReviewState { status: "unseen" | "seen" | "checked" | "changed"; seenAt: string | null; checkedAt: string | null }

export function singleReviewDay(range: TimeRange, now: Date): string | null {
  const start = ictYmd(range.start), end = ictYmd(new Date(range.end.getTime() - 1));
  return start === end && start <= ictYmd(now) ? start : null;
}
/** Personal check confirms the whole default category, never a searched/filtered subset. */
export function canReviewParams(params: ListParams): boolean {
  return !params.q && Object.entries(params.filters).every(([key, values]) => !values.length ||
    (key === "state" && values.length === 1 && values[0] === "active") ||
    (key === "type" && values.length === 1 && values[0] === "LOSS"));
}
export function reviewState(row: DailyReview | null | undefined, version: string | undefined): ReviewState {
  const base = { seenAt: row?.seenAt?.toISOString() ?? null, checkedAt: row?.checkedAt?.toISOString() ?? null };
  if (!row || !version) return { ...base, status: "unseen" };
  if (row.checkedAt && row.checkedVersion === version) return { ...base, status: "checked" };
  if (row.seenAt && row.seenVersion === version) return { ...base, status: "seen" };
  return { ...base, status: "changed" };
}

export async function getDailyReviews(db: PrismaClient, actor: Actor, day: string) {
  return db.dailyReview.findMany({ where: { userId: actor.userId, day: new Date(`${day}T00:00:00Z`) } });
}

export async function updateDailyReview(db: PrismaClient, actor: Actor, input: ReviewInput, now: Date = new Date()) {
  const item = requireDailyItem(actor, input.itemKey);
  if (input.day > ictYmd(now)) throw new DomainError("Không đánh dấu kiểm tra ngày tương lai.", 400);
  const params = parseListParams({ timePreset: "custom", timeStart: input.day, timeEnd: input.day });
  const { totals } = await loadDailyItem(db, actor, item.key, params, now, { summaryOnly: true });
  if (input.action !== "uncheck" && totals.version !== input.expectedVersion) throw new DomainError("Số liệu đã thay đổi. Hãy làm mới và xem lại trước khi xác nhận.", 409);
  const day = new Date(`${input.day}T00:00:00Z`);
  return db.$transaction(async (tx) => {
    const where = { userId_day_itemKey: { userId: actor.userId, day, itemKey: item.key } };
    const before = await tx.dailyReview.findUnique({ where });
    if (input.action === "check" && before?.seenVersion !== totals.version) throw new DomainError("Mở chi tiết để xem số liệu trước khi đánh dấu đã kiểm tra.", 409);
    if (input.action === "check" && before?.checkedVersion === totals.version) return reviewState(before, totals.version);
    if (input.action === "seen" && before?.seenVersion === totals.version) return reviewState(before, totals.version);
    if (input.action === "uncheck" && !before) return reviewState(null, totals.version);
    const patch = input.action === "uncheck" ? { checkedAt: null, checkedVersion: null } : {
      seenAt: now, seenVersion: totals.version!, ...(input.action === "check" ? { checkedAt: now, checkedVersion: totals.version! } : {}),
    };
    const after = await tx.dailyReview.upsert({ where, create: { userId: actor.userId, day, itemKey: item.key, ...patch }, update: patch });
    await writeAudit(tx, { userId: actor.userId, action: `daily_review.${input.action}`, entity: "DailyReview", entityId: `${actor.userId}:${input.day}:${item.key}`, before, after });
    return reviewState(after, totals.version);
  });
}
