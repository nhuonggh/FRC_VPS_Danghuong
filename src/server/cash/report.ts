import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { ictYmd, ICT_OFFSET_MS } from "@/lib/time";
import { resolveTimeRange } from "@/lib/time-presets";
import { getOpenPeriod } from "@/server/period/guard";

type Db = Prisma.TransactionClient | PrismaClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const DAY_MS = 24 * 3600_000;
const dayStart = (ymd: string) => new Date(new Date(`${ymd}T00:00:00Z`).getTime() - ICT_OFFSET_MS);

export interface CashDailyRowDTO {
  ymd: string; opening: string; in: string; out: string; topUp: string; closing: string; pendingCount: number;
  /** Lần chốt đầu tiên (chưa hủy) có mốc từ hết ngày này trở đi; null = ngày chưa chốt. */
  close: { at: Date; actual: string; diff: string; byName: string | null } | null;
}
export interface CashReviewerRowDTO { reviewerId: number | null; name: string; vouchers: number; in: string; out: string; closes: number; closeDiff: string }
export interface CashReportDTO {
  accounts: { id: number; name: string }[]; selectedId: number | null; accountName: string; periodName: string;
  days: CashDailyRowDTO[]; reviewers: CashReviewerRowDTO[]; unclosedDays: number;
}

/**
 * Báo cáo quỹ tiền mặt theo ngày (đầu ngày = cuối ngày trước, tự tính) và theo người kiểm tra (người bấm "kiểm tra" phiếu;
 * kèm lần chốt quỹ do họ lập). Chỉ đọc: ngày chưa chốt vẫn nhập phiếu/bổ sung quỹ bình thường.
 */
export async function cashReport(db: Db, actor: Actor, accountId: number | null, params: ListParams): Promise<CashReportDTO> {
  assertCan(actor.perms, "cashbook.view");
  const period = await getOpenPeriod(db);
  const periodRow = await db.period.findUniqueOrThrow({ where: { id: period.id }, select: { name: true } });
  const list = await db.cashAccount.findMany({ where: { type: "CASH", OR: [{ isActive: true }, ...(accountId ? [{ id: accountId }] : [])] }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const selected = list.find((a) => a.id === accountId) ?? list[0] ?? null;
  const empty = { accounts: list, selectedId: selected?.id ?? null, accountName: selected?.name ?? "", periodName: periodRow.name, days: [], reviewers: [], unclosedDays: 0 };
  if (!selected) return empty;

  const range = params.timePreset ? resolveTimeRange(params.timePreset, new Date(), { start: params.timeStart, end: params.timeEnd }) : null;
  const [opening, ledger, closes] = await Promise.all([
    db.openingCash.findUnique({ where: { periodId_cashAccountId: { periodId: period.id, cashAccountId: selected.id } }, select: { amount: true } }),
    db.cashLedger.findMany({ where: { periodId: period.id, cashAccountId: selected.id }, orderBy: [{ at: "asc" }, { id: "asc" }] }),
    db.cashClose.findMany({ where: { periodId: period.id, cashAccountId: selected.id, voidedAt: null }, orderBy: { closeAt: "asc" } }),
  ]);
  const ids = (t: string) => [...new Set(ledger.filter((l) => l.docType === t).map((l) => l.docId))];
  const [receipts, payments] = await Promise.all([
    db.receipt.findMany({ where: { id: { in: ids("RECEIPT") } }, select: { id: true, type: true, reviewStatus: true, reviewedBy: true } }),
    db.payment.findMany({ where: { id: { in: ids("PAYMENT") } }, select: { id: true, reviewStatus: true, reviewedBy: true } }),
  ]);
  const receiptOf = new Map(receipts.map((r) => [r.id, r])), paymentOf = new Map(payments.map((p) => [p.id, p]));
  const userIds = [...receipts.map((r) => r.reviewedBy ?? 0), ...payments.map((p) => p.reviewedBy ?? 0), ...closes.map((c) => c.createdBy)].filter(Boolean);
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));

  // ── theo ngày ──
  const byDay = new Map<string, { in: Prisma.Decimal; out: Prisma.Decimal; topUp: Prisma.Decimal; pending: number }>();
  for (const l of ledger) {
    const ymd = ictYmd(l.at);
    const d = byDay.get(ymd) ?? { in: D(0), out: D(0), topUp: D(0), pending: 0 };
    d.in = d.in.plus(l.amountIn); d.out = d.out.plus(l.amountOut);
    if (l.docType === "RECEIPT" && receiptOf.get(l.docId)?.type === "BO_SUNG_QUY") d.topUp = d.topUp.plus(l.amountIn);
    const st = l.docType === "RECEIPT" ? receiptOf.get(l.docId)?.reviewStatus : l.docType === "PAYMENT" ? paymentOf.get(l.docId)?.reviewStatus : "REVIEWED";
    if (st && st !== "REVIEWED") d.pending += 1;
    byDay.set(ymd, d);
  }
  let run = D(opening?.amount ?? 0);
  const days: CashDailyRowDTO[] = [];
  for (const ymd of [...byDay.keys()].sort()) {
    const d = byDay.get(ymd)!, start = dayStart(ymd), end = new Date(start.getTime() + DAY_MS);
    const closing = run.plus(d.in).minus(d.out);
    const c = closes.find((x) => x.closeAt >= new Date(end.getTime() - 1));
    if (!range || (start >= range.start && start < range.end)) {
      days.push({ ymd, opening: run.toString(), in: d.in.toString(), out: d.out.toString(), topUp: d.topUp.toString(), closing: closing.toString(), pendingCount: d.pending,
        close: c ? { at: c.closeAt, actual: c.actual.toString(), diff: c.diff.toString(), byName: users.get(c.createdBy) ?? null } : null });
    }
    run = closing;
  }
  days.reverse();

  // ── theo người kiểm tra ──
  const inRange = (at: Date) => !range || (at >= range.start && at < range.end);
  const acc = new Map<number | null, { vouchers: Set<string>; in: Prisma.Decimal; out: Prisma.Decimal; closes: number; diff: Prisma.Decimal }>();
  const slot = (id: number | null) => { let s = acc.get(id); if (!s) { s = { vouchers: new Set(), in: D(0), out: D(0), closes: 0, diff: D(0) }; acc.set(id, s); } return s; };
  for (const l of ledger) {
    if (l.docType === "CASH_ADJ" || !inRange(l.at)) continue;
    const v = l.docType === "RECEIPT" ? receiptOf.get(l.docId) : paymentOf.get(l.docId);
    if (!v) continue;
    const s = slot(v.reviewStatus === "REVIEWED" ? (v.reviewedBy ?? null) : null);
    s.vouchers.add(`${l.docType}:${l.docId}`); s.in = s.in.plus(l.amountIn); s.out = s.out.plus(l.amountOut);
  }
  for (const c of closes) if (inRange(c.closeAt)) { const s = slot(c.createdBy); s.closes += 1; s.diff = s.diff.plus(c.diff); }
  const reviewers: CashReviewerRowDTO[] = [...acc.entries()].map(([id, s]) => ({
    reviewerId: id, name: id === null ? "Chưa kiểm tra" : (users.get(id) ?? `#${id}`), vouchers: s.vouchers.size, in: s.in.toString(), out: s.out.toString(), closes: s.closes, closeDiff: s.diff.toString(),
  })).sort((a, b) => (a.reviewerId === null ? 1 : b.reviewerId === null ? -1 : a.name.localeCompare(b.name, "vi")));

  const today = ictYmd(new Date());
  return { ...empty, days, reviewers, unclosedDays: days.filter((d) => !d.close && d.ymd < today).length };
}
