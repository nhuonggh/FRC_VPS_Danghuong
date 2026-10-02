import { Prisma, type PrismaClient } from "@prisma/client";
import { can } from "@/lib/permissions/guard";
import { partnerScopeWhere, type Actor } from "@/lib/permissions/scope";
import { ictStartOfDay, ictYmd, toIct } from "@/lib/time";
import { resolveTimeRange, type TimePreset } from "@/lib/time-presets";
import type { Cell, CellTone, DashTone } from "./types";

export type Db = PrismaClient;

/** Khoảng đang xem + khoảng liền trước cùng độ dài (để tính delta "so với kỳ trước"). */
export interface DashRange { start: Date; end: Date; prevStart: Date; prevEnd: Date }

/** Mặc định "Tháng này"; `custom` sai → cũng rơi về tháng này (dashboard luôn có khoảng thời gian). */
export function dashRange(
  preset: TimePreset | undefined,
  custom: { start?: string; end?: string } | undefined,
  now: Date,
): DashRange {
  const r = resolveTimeRange(preset ?? "thisMonth", now, custom) ?? resolveTimeRange("thisMonth", now)!;
  const len = r.end.getTime() - r.start.getTime();
  return { start: r.start, end: r.end, prevStart: new Date(r.start.getTime() - len), prevEnd: r.start };
}

export const num = (v: Prisma.Decimal | number | string | bigint | null | undefined): number => (v == null ? 0 : Number(v));

/** % thay đổi; kỳ trước = 0 → null (không có cơ sở, không bịa ra "+∞%"). */
export function pctDelta(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}

export const share = (part: number, total: number): number => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);

export const canAny = (actor: Actor, codes: readonly Parameters<typeof can>[1][]): boolean => codes.some((c) => can(actor.perms, c));

/** Năm (ICT) của khoảng đang xem — biểu đồ "theo tháng" luôn vẽ T1…T12 của năm này. */
export function yearOfRange(range: DashRange): number {
  return toIct(new Date(range.end.getTime() - 1)).y;
}
export const yearBounds = (y: number) => ({ start: ictStartOfDay(y, 0, 1), end: ictStartOfDay(y + 1, 0, 1) });
export const MONTH_LABELS = Array.from({ length: 12 }, (_, i) => `T${i + 1}`);

/** SQL: tháng (1–12) theo giờ ICT của cột thời điểm. */
export const sqlMonth = (col: Prisma.Sql) => Prisma.sql`EXTRACT(MONTH FROM (${col} + interval '7 hours'))::int`;
/** SQL: ngày 'YYYY-MM-DD' theo giờ ICT của cột thời điểm. */
export const sqlDay = (col: Prisma.Sql) => Prisma.sql`to_char((${col} + interval '7 hours'), 'YYYY-MM-DD')`;

/** Mảng 12 phần tử (T1…T12) từ các dòng {m, …}. */
export function byMonth<T extends { m: number }>(rows: T[], pick: (r: T) => number): number[] {
  const out = Array<number>(12).fill(0);
  for (const r of rows) if (r.m >= 1 && r.m <= 12) out[r.m - 1] = pick(r);
  return out;
}

const MAX_DAYS = 92;
/** Danh sách ngày ICT trong khoảng (tối đa 92 ngày — dài hơn thì biểu đồ theo ngày không đọc được). */
export function daysOf(range: DashRange): { key: string; label: string }[] | null {
  const days: { key: string; label: string }[] = [];
  for (let t = range.start.getTime(); t < range.end.getTime(); t += 24 * 3600 * 1000) {
    if (days.length >= MAX_DAYS) return null;
    const key = ictYmd(new Date(t));
    days.push({ key, label: `${key.slice(8, 10)}/${key.slice(5, 7)}` });
  }
  return days;
}
export function byDay<T extends { d: string }>(days: { key: string }[], rows: T[], pick: (r: T) => number): number[] {
  const m = new Map(rows.map((r) => [r.d, pick(r)]));
  return days.map((d) => m.get(d.key) ?? 0);
}

/** Gộp phần dư vào "Khác" khi quá `max` lát (donut). */
export function topSlices<T extends { label: string; value: number }>(items: T[], max: number): { label: string; value: number }[] {
  const sorted = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= max) return sorted.map(({ label, value }) => ({ label, value }));
  const head = sorted.slice(0, max - 1).map(({ label, value }) => ({ label, value }));
  return [...head, { label: "Khác", value: sorted.slice(max - 1).reduce((s, i) => s + i.value, 0) }];
}

export const KIND_LABEL: Record<string, string> = { HANG: "Hàng hóa", NVL: "Nguyên vật liệu", THANH_PHAM: "Thành phẩm", PHU_KIEN: "Phụ kiện" };

export const cell = (text: string, extra: { href?: string; tone?: CellTone; align?: "right" } = {}): Cell => ({ text, ...extra });
export const toneOf = (t: DashTone): CellTone => (t === "accent" || t === "info" ? "info" : t);

/** Phạm vi "khách của mình" dưới dạng SQL cho bảng `partners p` (thiếu partner.view_all → chỉ khách mình phụ trách). */
export const sqlPartnerScope = (actor: Actor): Prisma.Sql =>
  can(actor.perms, "partner.view_all") ? Prisma.empty : Prisma.sql`AND p."ownerUserId" = ${actor.userId}`;

export interface PartnerBalanceRow { id: number; code: string; name: string; balance: number }

/**
 * Số dư công nợ từng đối tác của kỳ đang mở = đầu kỳ + Σ(nợ − có) (cùng quy ước `partnerBalance`: dương = phải thu,
 * âm = phải trả). Một lần truy vấn gộp cho mọi đối tác, tôn trọng phạm vi "khách của mình".
 */
export async function partnerBalances(db: Db, actor: Actor, periodId: number): Promise<PartnerBalanceRow[]> {
  const [partners, opening, sums] = await Promise.all([
    db.partner.findMany({ where: partnerScopeWhere(actor), select: { id: true, code: true, name: true } }),
    db.openingDebt.findMany({ where: { periodId }, select: { partnerId: true, amount: true } }),
    db.partnerLedger.groupBy({ by: ["partnerId"], where: { periodId }, _sum: { debit: true, credit: true } }),
  ]);
  const o = new Map(opening.map((r) => [r.partnerId, num(r.amount)]));
  const s = new Map(sums.map((r) => [r.partnerId, num(r._sum.debit) - num(r._sum.credit)]));
  return partners
    .map((p) => ({ id: p.id, code: p.code, name: p.name, balance: Math.round(((o.get(p.id) ?? 0) + (s.get(p.id) ?? 0)) * 100) / 100 }))
    .filter((p) => p.balance !== 0);
}
