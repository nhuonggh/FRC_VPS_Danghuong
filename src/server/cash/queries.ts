import { Prisma, type CashReviewStatus, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import type { ListParams } from "@/lib/query-params";
import { escapeLike, normalizeSearch } from "@/lib/search";
import { resolveTimeRange, timeRangeWhere } from "@/lib/time-presets";
import { DomainError } from "@/server/http/errors";
import { getOpenPeriod } from "@/server/period/guard";
import { partnerBalance } from "@/server/debt/balance";
import { cashBalance } from "./balance";
import { PAYMENT_KIND_LABEL, RECEIPT_TYPE_LABEL, type VoucherDoc } from "./schemas";

type Db = Prisma.TransactionClient | PrismaClient;
export const VOUCHER_FILTER_KEYS = ["status", "type", "account", "cashType"] as const;
export const CASHBOOK_FILTER_KEYS = ["docType"] as const;
export const QUEUE_FILTER_KEYS = ["kind", "status", "account", "cashType"] as const;

function accountScope(params: ListParams): { cashAccountId?: number; cashAccount?: { type: "BANK" | "CASH" } } {
  const account = params.filters.account?.[0], type = params.filters.cashType?.[0];
  return {
    ...(account && /^\d{1,9}$/.test(account) ? { cashAccountId: Number(account) } : {}),
    ...(type === "BANK" || type === "CASH" ? { cashAccount: { type } } : {}),
  };
}

import { EVENT_LABEL, REVIEW_LABEL } from "./labels";
export { EVENT_LABEL, REVIEW_LABEL };

export interface VoucherRowDTO {
  id: number; doc: VoucherDoc; code: string; at: Date; type: string; typeLabel: string; partnerName: string | null; orderCode: string | null;
  amount: string; cashAccountName: string; reviewStatus: CashReviewStatus; isCancelled: boolean; note: string | null; createdByName: string | null;
}
export interface VoucherStatsDTO { pending: number; returned: number; reviewed: number; pendingAmount: string }

const fullName = async (db: Db, ids: number[]) => new Map((await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));

/** Danh sách phiếu thu/chi (56, 58) + số đếm theo trạng thái hậu kiểm. Lọc: status (PENDING_REVIEW|REVIEWED|RETURNED|CANCELLED), type, q, thời gian. */
export async function listVouchers(db: Db, actor: Actor, doc: VoucherDoc, params: ListParams): Promise<{ rows: VoucherRowDTO[]; total: number; stats: VoucherStatsDTO }> {
  assertCan(actor.perms, doc === "RECEIPT" ? "receipt.manage" : "payment.manage");
  const terms = normalizeSearch(params.q ?? "").split(" ").filter(Boolean);
  const range = (params.timePreset ? resolveTimeRange(params.timePreset, new Date(), { start: params.timeStart, end: params.timeEnd }) : null);
  const statuses = params.filters.status ?? []; const types = params.filters.type ?? [];
  const cancelled = statuses.includes("CANCELLED"); const live = statuses.filter((s) => s !== "CANCELLED") as CashReviewStatus[];
  const stateWhere = statuses.length === 0 ? {} : { OR: [...(cancelled ? [{ isCancelled: true }] : []), ...(live.length ? [{ isCancelled: false, reviewStatus: { in: live } }] : [])] };
  const scoped = { ...accountScope(params), ...(range ? { at: timeRangeWhere(range) } : {}) };
  const common = {
    ...stateWhere, ...scoped,
    AND: terms.map((t) => ({ OR: [{ code: { contains: escapeLike(t.toUpperCase()) } }, { partner: { searchText: { contains: escapeLike(t) } } }] })),
  };
  const page = { orderBy: [{ at: "desc" as const }, { id: "desc" as const }], skip: (params.page - 1) * params.pageSize, take: params.pageSize };
  const count = (status: CashReviewStatus) => (doc === "RECEIPT" ? db.receipt.count({ where: { ...scoped, isCancelled: false, reviewStatus: status } }) : db.payment.count({ where: { ...scoped, isCancelled: false, reviewStatus: status } }));
  const [pending, returned, reviewed] = await Promise.all([count("PENDING_REVIEW"), count("RETURNED"), count("REVIEWED")]);
  const pendSum = doc === "RECEIPT"
    ? await db.receipt.aggregate({ where: { ...scoped, isCancelled: false, reviewStatus: { not: "REVIEWED" } }, _sum: { amount: true } })
    : await db.payment.aggregate({ where: { ...scoped, isCancelled: false, reviewStatus: { not: "REVIEWED" } }, _sum: { amount: true } });
  let rows: VoucherRowDTO[]; let total: number;
  if (doc === "RECEIPT") {
    const where: Prisma.ReceiptWhereInput = { ...common, ...(types.length ? { type: { in: types as never } } : {}) };
    const [list, n] = await Promise.all([db.receipt.findMany({ where, ...page, include: { partner: { select: { name: true } }, order: { select: { code: true } }, cashAccount: { select: { name: true } } } }), db.receipt.count({ where })]);
    const names = await fullName(db, list.map((r) => r.createdBy));
    rows = list.map((r) => ({ id: r.id, doc, code: r.code, at: r.at, type: r.type, typeLabel: RECEIPT_TYPE_LABEL[r.type] ?? r.type, partnerName: r.partner?.name ?? null, orderCode: r.order?.code ?? null, amount: r.amount.toString(), cashAccountName: r.cashAccount.name, reviewStatus: r.reviewStatus, isCancelled: r.isCancelled, note: r.note, createdByName: names.get(r.createdBy) ?? null }));
    total = n;
  } else {
    const where: Prisma.PaymentWhereInput = { ...common, ...(types.length ? { kind: { in: types as never } } : {}) };
    const [list, n] = await Promise.all([db.payment.findMany({ where, ...page, include: { partner: { select: { name: true } }, cashAccount: { select: { name: true } } } }), db.payment.count({ where })]);
    const names = await fullName(db, list.map((r) => r.createdBy));
    rows = list.map((r) => ({ id: r.id, doc, code: r.code, at: r.at, type: r.kind, typeLabel: PAYMENT_KIND_LABEL[r.kind] ?? r.kind, partnerName: r.partner?.name ?? null, orderCode: null, amount: r.amount.toString(), cashAccountName: r.cashAccount.name, reviewStatus: r.reviewStatus, isCancelled: r.isCancelled, note: r.note, createdByName: names.get(r.createdBy) ?? null }));
    total = n;
  }
  return { rows, total, stats: { pending, returned, reviewed, pendingAmount: (pendSum._sum.amount ?? new Prisma.Decimal(0)).toString() } };
}

export interface VoucherDetailDTO extends VoucherRowDTO {
  advancedById?: number | null; advancedByDriverId?: number | null; advancedByName?: string | null;
  /** Khoản chi phí hoạt động tương ứng (phiếu chi loại CHI_PHI) — sửa ở màn Chi phí. */
  expenseId: number | null;
  partnerId: number | null; orderId: number | null; cashAccountId: number; dateYmd: string; reviewedByName: string | null; reviewedAt: Date | null;
  events: { id: number; action: string; actionLabel: string; reason: string | null; userName: string | null; at: Date }[];
  adjustments: { id: number; kind: "AMOUNT" | "VOID"; status: "REQUESTED" | "APPROVED" | "REJECTED"; reason: string; newAmount: string | null; newCashAccountName: string | null; oldAmount: string | null; requestedByName: string | null; requestedAt: Date; decidedByName: string | null; decidedAt: Date | null; decisionNote: string | null }[];
}

export async function getVoucher(db: Db, actor: Actor, doc: VoucherDoc, id: number): Promise<VoucherDetailDTO> {
  assertCan(actor.perms, doc === "RECEIPT" ? "receipt.manage" : "payment.manage");
  const [events, adjustments] = await Promise.all([
    db.cashReviewEvent.findMany({ where: { docType: doc, docId: id }, orderBy: [{ at: "asc" }, { id: "asc" }] }),
    db.cashAdjustment.findMany({ where: { docType: doc, docId: id }, orderBy: { id: "desc" } }),
  ]);
  const base = doc === "RECEIPT"
    ? await db.receipt.findUnique({ where: { id }, include: { partner: { select: { name: true } }, order: { select: { code: true } }, cashAccount: { select: { name: true } } } })
    : await db.payment.findUnique({ where: { id }, include: { partner: { select: { name: true } }, cashAccount: { select: { name: true } } } });
  if (!base) throw new DomainError(doc === "RECEIPT" ? "Không tìm thấy phiếu thu." : "Không tìm thấy phiếu chi.", 404);
  const accounts = new Map((await db.cashAccount.findMany({ where: { id: { in: adjustments.flatMap((a) => (a.newCashAccountId ? [a.newCashAccountId] : [])) } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]));
  const names = await fullName(db, [base.createdBy, ...(base.reviewedBy ? [base.reviewedBy] : []), ...events.map((e) => e.userId), ...adjustments.flatMap((a) => [a.requestedBy, ...(a.decidedBy ? [a.decidedBy] : [])])]);
  const advancedById = "advancedById" in base ? base.advancedById : null;
  const advancedByDriverId = "advancedByDriverId" in base ? base.advancedByDriverId : null;
  const advancedBy = advancedById ? await db.user.findUnique({ where: { id: advancedById }, select: { fullName: true } }) : null;
  const advancedByDriver = advancedByDriverId ? await db.driver.findUnique({ where: { id: advancedByDriverId }, select: { name: true } }) : null;
  const type = "type" in base ? base.type : base.kind;
  const expense = type === "CHI_PHI" ? await db.operatingExpense.findUnique({ where: { paymentId: id }, select: { id: true, expenseType: { select: { name: true } } } }) : null;
  const at = base.at; const t = new Date(at.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  return {
    advancedById, advancedByDriverId, advancedByName: advancedBy?.fullName ?? advancedByDriver?.name ?? null,
    id, doc, code: base.code, at, type, typeLabel: expense ? `Chi phí — ${expense.expenseType.name}` : (doc === "RECEIPT" ? RECEIPT_TYPE_LABEL : PAYMENT_KIND_LABEL)[type] ?? type, expenseId: expense?.id ?? null, partnerId: base.partnerId, partnerName: base.partner?.name ?? null,
    orderId: "orderId" in base ? base.orderId : null, orderCode: "order" in base ? (base.order?.code ?? null) : null, amount: base.amount.toString(), cashAccountId: base.cashAccountId, cashAccountName: base.cashAccount.name,
    reviewStatus: base.reviewStatus, isCancelled: base.isCancelled, note: base.note, createdByName: names.get(base.createdBy) ?? null, dateYmd: t,
    reviewedByName: base.reviewedBy ? (names.get(base.reviewedBy) ?? null) : null, reviewedAt: base.reviewedAt,
    events: events.map((e) => ({ id: e.id, action: e.action, actionLabel: EVENT_LABEL[e.action] ?? e.action, reason: e.reason, userName: names.get(e.userId) ?? null, at: e.at })),
    adjustments: adjustments.map((a) => ({ id: a.id, kind: a.kind, status: a.status, reason: a.reason, newAmount: a.newAmount?.toString() ?? null, newCashAccountName: a.newCashAccountId ? (accounts.get(a.newCashAccountId) ?? null) : null, oldAmount: a.oldAmount?.toString() ?? null, requestedByName: names.get(a.requestedBy) ?? null, requestedAt: a.requestedAt, decidedByName: a.decidedBy ? (names.get(a.decidedBy) ?? null) : null, decidedAt: a.decidedAt, decisionNote: a.decisionNote })),
  };
}

// ───────────────────────────── HÀNG CHỜ KIỂM TRA ─────────────────────────────
export interface QueueRowDTO {
  key: string; kind: "RECEIPT" | "PAYMENT" | "ADJUSTMENT"; id: number; doc: VoucherDoc; code: string; at: Date; label: string; partnerName: string | null;
  amount: string; status: CashReviewStatus | "ADJUST_REQUESTED"; statusLabel: string; createdByName: string | null; detail: string | null; adjustmentId: number | null;
}

/** Việc thủ quỹ cần làm: phiếu thu/chi chưa kiểm tra (chờ + bị trả lại) và yêu cầu điều chỉnh đang chờ duyệt. Lọc: kind, status, q, thời gian. */
export async function listReviewQueue(db: Db, actor: Actor, params: ListParams) {
  assertCan(actor.perms, "cash.review");
  const terms = normalizeSearch(params.q ?? "").split(" ").filter(Boolean);
  const range = (params.timePreset ? resolveTimeRange(params.timePreset, new Date(), { start: params.timeStart, end: params.timeEnd }) : null);
  const kinds = params.filters.kind ?? []; const statuses = params.filters.status ?? [];
  const want = (k: string) => kinds.length === 0 || kinds.includes(k);
  const wantStatus = (s: string) => statuses.length === 0 || statuses.includes(s);
  const statusIn = (["PENDING_REVIEW", "RETURNED"] as CashReviewStatus[]).filter(wantStatus);
  const textWhere = terms.map((t) => ({ OR: [{ code: { contains: escapeLike(t.toUpperCase()) } }, { partner: { searchText: { contains: escapeLike(t) } } }] }));
  const common = { ...accountScope(params), isCancelled: false, ...(range ? { at: timeRangeWhere(range) } : {}), AND: textWhere };
  const [receipts, payments, adjs] = await Promise.all([
    want("RECEIPT") && statusIn.length ? db.receipt.findMany({ where: { ...common, reviewStatus: { in: statusIn } }, include: { partner: { select: { name: true } } } }) : [],
    want("PAYMENT") && statusIn.length ? db.payment.findMany({ where: { ...common, reviewStatus: { in: statusIn } }, include: { partner: { select: { name: true } } } }) : [],
    want("ADJUSTMENT") && wantStatus("ADJUST_REQUESTED") ? db.cashAdjustment.findMany({ where: { status: "REQUESTED", ...(range ? { requestedAt: timeRangeWhere(range) } : {}) } }) : [],
  ]);
  const adjVouchers = await Promise.all(adjs.map((a) => (a.docType === "RECEIPT" ? db.receipt.findUnique({ where: { id: a.docId }, include: { partner: { select: { name: true } }, cashAccount: { select: { type: true } } } }) : db.payment.findUnique({ where: { id: a.docId }, include: { partner: { select: { name: true } }, cashAccount: { select: { type: true } } } }))));
  const names = await fullName(db, [...receipts.map((r) => r.createdBy), ...payments.map((r) => r.createdBy), ...adjs.map((a) => a.requestedBy)]);
  const rows: QueueRowDTO[] = [
    ...receipts.map((r) => ({ key: `R${r.id}`, kind: "RECEIPT" as const, id: r.id, doc: "RECEIPT" as const, code: r.code, at: r.at, label: `Thu — ${RECEIPT_TYPE_LABEL[r.type] ?? r.type}`, partnerName: r.partner?.name ?? null, amount: r.amount.toString(), status: r.reviewStatus, statusLabel: REVIEW_LABEL[r.reviewStatus], createdByName: names.get(r.createdBy) ?? null, detail: r.note, adjustmentId: null })),
    ...payments.map((r) => ({ key: `P${r.id}`, kind: "PAYMENT" as const, id: r.id, doc: "PAYMENT" as const, code: r.code, at: r.at, label: `Chi — ${PAYMENT_KIND_LABEL[r.kind] ?? r.kind}`, partnerName: r.partner?.name ?? null, amount: r.amount.toString(), status: r.reviewStatus, statusLabel: REVIEW_LABEL[r.reviewStatus], createdByName: names.get(r.createdBy) ?? null, detail: r.note, adjustmentId: null })),
    ...adjs.flatMap((a, i) => { const v = adjVouchers[i]; const scope = accountScope(params); if (!v || (scope.cashAccountId !== undefined && v.cashAccountId !== scope.cashAccountId) || (scope.cashAccount && v.cashAccount.type !== scope.cashAccount.type)) return []; const doc = a.docType as VoucherDoc; return [{ key: `A${a.id}`, kind: "ADJUSTMENT" as const, id: a.docId, doc, code: v.code, at: a.requestedAt, label: a.kind === "VOID" ? "Điều chỉnh — hủy phiếu" : "Điều chỉnh — đổi số tiền/quỹ", partnerName: v.partner?.name ?? null, amount: (a.newAmount ?? v.amount).toString(), status: "ADJUST_REQUESTED" as const, statusLabel: "Chờ duyệt điều chỉnh", createdByName: names.get(a.requestedBy) ?? null, detail: a.reason, adjustmentId: a.id }]; }),
  ].sort((x, y) => y.at.getTime() - x.at.getTime());
  return { total: rows.length, stats: { receipts: rows.filter((r) => r.kind === "RECEIPT").length, payments: rows.filter((r) => r.kind === "PAYMENT").length, adjustments: rows.filter((r) => r.kind === "ADJUSTMENT").length }, rows: rows.slice((params.page - 1) * params.pageSize, params.page * params.pageSize) };
}

// ───────────────────────────── SỔ QUỸ / SỔ NGÂN HÀNG (60, 61) ─────────────────────────────
export interface CashAccountSummaryDTO { id: number; name: string; bankNo: string | null; type: "CASH" | "BANK"; opening: string; in: string; out: string; balance: string; reviewed: string; pending: string }
export interface CashEntryDTO { id: number; at: Date; docType: string; docId: number; docLabel: string; docCode: string | null; docHref: string | null; reviewStatus: CashReviewStatus | null; amountIn: string; amountOut: string; running: string; content: string | null; counterparty: string | null; reviewerName: string | null }
export interface CashCloseDTO { id: number; closeAt: Date; expected: string; actual: string; diff: string; reason: string | null; createdByName: string | null; createdAt: Date; voided: boolean; voidReason: string | null }
export interface CashBookDTO { accounts: CashAccountSummaryDTO[]; selected: CashAccountSummaryDTO | null; entries: CashEntryDTO[]; total: number; closes: CashCloseDTO[]; periodName: string; /** Số dư ngay trước khoảng ngày đang lọc (null = không lọc ngày). */ rangeOpening: string | null; /** Phiếu chi "Nộp lại quỹ" còn hiệu lực lập trong ngày hôm nay của quỹ đang chọn — để cảnh báo khi chốt quỹ. */ handOversToday: { code: string; amount: string }[] }
const DOC_LABEL: Record<string, string> = { RECEIPT: "Phiếu thu", PAYMENT: "Phiếu chi", CASH_ADJ: "Điều chỉnh phiếu" };

export async function listCashBook(db: Db, actor: Actor, type: "CASH" | "BANK", accountId: number | null, params: ListParams): Promise<CashBookDTO> {
  assertCan(actor.perms, "cashbook.view");
  const period = await getOpenPeriod(db);
  const periodRow = await db.period.findUniqueOrThrow({ where: { id: period.id }, select: { name: true } });
  const list = await db.cashAccount.findMany({ where: { type, OR: [{ isActive: true }, ...(accountId ? [{ id: accountId }] : [])] }, orderBy: { name: "asc" } });
  const accounts: CashAccountSummaryDTO[] = [];
  for (const a of list) {
    const b = await cashBalance(db, period.id, a.id);
    accounts.push({ id: a.id, name: a.name, bankNo: a.bankNo, type: a.type, opening: b.opening.toString(), in: b.in.toString(), out: b.out.toString(), balance: b.balance.toString(), reviewed: b.reviewed.toString(), pending: b.pending.toString() });
  }
  const selected = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;
  if (!selected) return { accounts, selected: null, entries: [], total: 0, closes: [], periodName: periodRow.name, rangeOpening: null, handOversToday: [] };
  const today = resolveTimeRange("today", new Date())!;
  const handOversToday = (await db.payment.findMany({ where: { periodId: period.id, cashAccountId: selected.id, kind: "NOP_LAI_QUY", isCancelled: false, at: { gte: today.start, lt: today.end } }, select: { code: true, amount: true }, orderBy: { id: "asc" } })).map((p) => ({ code: p.code, amount: p.amount.toString() }));
  const rows = await db.cashLedger.findMany({ where: { periodId: period.id, cashAccountId: selected.id }, orderBy: [{ at: "asc" }, { id: "asc" }] });
  let run = new Prisma.Decimal(selected.opening);
  const withRun = rows.map((r) => { run = run.plus(r.amountIn).minus(r.amountOut); return { r, running: run }; });
  const range = params.timePreset ? resolveTimeRange(params.timePreset, new Date(), { start: params.timeStart, end: params.timeEnd }) : null;
  // Calculate running balances BEFORE filtering, retaining earlier movements.
  const filtered = withRun.filter(({ r }) => !range || (r.at >= range.start && r.at < range.end));
  const rangeOpening = range ? (withRun.filter(({ r }) => r.at < range.start).at(-1)?.running ?? new Prisma.Decimal(selected.opening)).toString() : null;
  const types = (params.filters.docType ?? []).filter((t) => t in DOC_LABEL);
  const ordered = filtered.filter(({ r }) => !types.length || types.includes(r.docType)).reverse();
  const needle = params.q ? normalizeSearch(params.q) : "";
  const pageStart = (params.page - 1) * params.pageSize;
  // Có từ khóa tìm → nạp chứng từ của mọi dòng đã lọc để so khớp; không thì chỉ nạp trang hiện tại.
  const lookup = needle ? ordered : ordered.slice(pageStart, pageStart + params.pageSize);
  const idsOf = (t: string) => lookup.filter((x) => x.r.docType === t).map((x) => x.r.docId);
  const [receipts, payments, adjs, closes] = await Promise.all([
    db.receipt.findMany({ where: { id: { in: idsOf("RECEIPT") } }, select: { id: true, code: true, reviewStatus: true, type: true, note: true, reviewedBy: true, partner: { select: { name: true } } } }),
    db.payment.findMany({ where: { id: { in: idsOf("PAYMENT") } }, select: { id: true, code: true, reviewStatus: true, kind: true, note: true, reviewedBy: true, advancedById: true, partner: { select: { name: true } }, expense: { select: { expenseType: { select: { name: true } } } } } }),
    db.cashAdjustment.findMany({ where: { id: { in: idsOf("CASH_ADJ") } }, select: { id: true, docType: true, docId: true, decidedBy: true } }),
    db.cashClose.findMany({ where: { cashAccountId: selected.id, periodId: period.id }, orderBy: { closeAt: "desc" }, take: 20 }),
  ]);
  const adjDocs = await Promise.all(adjs.map(async (a) => (a.docType === "RECEIPT" ? db.receipt.findUnique({ where: { id: a.docId }, select: { code: true, id: true, type: true, note: true, partner: { select: { name: true } } } }) : db.payment.findUnique({ where: { id: a.docId }, select: { code: true, id: true, kind: true, note: true, advancedById: true, partner: { select: { name: true } }, expense: { select: { expenseType: { select: { name: true } } } } } }))));
  const names = await fullName(db, [...closes.map((c) => c.createdBy), ...receipts.map((r) => r.reviewedBy ?? 0), ...payments.flatMap((p) => [p.reviewedBy ?? 0, p.advancedById ?? 0]), ...adjs.map((a) => a.decidedBy ?? 0), ...adjDocs.map((d) => (d && "advancedById" in d ? (d.advancedById ?? 0) : 0))]);
  const nm = (id: number | null | undefined) => (id ? (names.get(id) ?? null) : null);
  const contentOf = (label: string | undefined, note: string | null) => [label, note].filter(Boolean).join(" — ") || null;
  const info = new Map<string, { code: string; href: string; status: CashReviewStatus | null; content: string | null; counterparty: string | null; reviewerName: string | null }>();
  receipts.forEach((r) => info.set(`RECEIPT:${r.id}`, { code: r.code, href: `/accounting/receipts/${r.id}`, status: r.reviewStatus, content: contentOf(RECEIPT_TYPE_LABEL[r.type], r.note), counterparty: r.partner?.name ?? null, reviewerName: nm(r.reviewedBy) }));
  payments.forEach((r) => info.set(`PAYMENT:${r.id}`, { code: r.code, href: `/accounting/payments/${r.id}`, status: r.reviewStatus, content: contentOf(PAYMENT_KIND_LABEL[r.kind], r.note), counterparty: r.partner?.name ?? r.expense?.expenseType.name ?? nm(r.advancedById), reviewerName: nm(r.reviewedBy) }));
  adjs.forEach((a, i) => { const d = adjDocs[i]; if (d) info.set(`CASH_ADJ:${a.id}`, { code: d.code, href: `/accounting/${a.docType === "RECEIPT" ? "receipts" : "payments"}/${d.id}`, status: "REVIEWED", content: contentOf("Điều chỉnh", d.note), counterparty: d.partner?.name ?? ("expense" in d ? d.expense?.expenseType.name ?? null : null) ?? ("advancedById" in d ? nm(d.advancedById) : null), reviewerName: nm(a.decidedBy) }); });
  const matched = needle ? ordered.filter(({ r }) => { const i = info.get(`${r.docType}:${r.docId}`); return normalizeSearch([i?.code, i?.content, i?.counterparty, DOC_LABEL[r.docType]].filter(Boolean).join(" ")).includes(needle); }) : ordered;
  const pageRows = matched.slice(pageStart, pageStart + params.pageSize);
  return {
    accounts, selected, total: matched.length, periodName: periodRow.name, rangeOpening, handOversToday,
    entries: pageRows.map(({ r, running }) => { const i = info.get(`${r.docType}:${r.docId}`); return { id: r.id, at: r.at, docType: r.docType, docId: r.docId, docLabel: DOC_LABEL[r.docType] ?? r.docType, docCode: i?.code ?? null, docHref: i?.href ?? null, reviewStatus: i?.status ?? null, amountIn: r.amountIn.toString(), amountOut: r.amountOut.toString(), running: running.toString(), content: i?.content ?? null, counterparty: i?.counterparty ?? null, reviewerName: i?.reviewerName ?? null }; }),
    closes: closes.map((c) => ({ id: c.id, closeAt: c.closeAt, expected: c.expected.toString(), actual: c.actual.toString(), diff: c.diff.toString(), reason: c.reason, createdByName: names.get(c.createdBy) ?? null, createdAt: c.createdAt, voided: c.voidedAt !== null, voidReason: c.voidReason })),
  };
}

// ───────────────────────────── Ô CHỌN TRONG FORM ─────────────────────────────
export interface CashOptionDTO { value: number; label: string; hint?: string }

/** Tìm đối tác cho phiếu thu/chi. role: customer (thu nợ, hoàn khách) | supplier (trả NCC) | any. */
export async function searchCashPartners(db: Db, actor: Actor, q: string, role: "customer" | "supplier" | "any"): Promise<CashOptionDTO[]> {
  assertCan(actor.perms, "cash.transaction.create");
  const terms = normalizeSearch(q).split(" ").filter(Boolean);
  const rows = await db.partner.findMany({
    where: { mergedIntoId: null, isActive: true, ...(role === "customer" ? { isCustomer: true } : role === "supplier" ? { isSupplier: true } : {}), AND: terms.map((t) => ({ OR: [{ searchText: { contains: escapeLike(t) } }, { code: { contains: escapeLike(t.toUpperCase()) } }] })) },
    orderBy: { name: "asc" }, take: 20, select: { id: true, code: true, name: true, isCustomer: true, isSupplier: true },
  });
  return rows.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}`, hint: [r.isCustomer ? "Khách" : null, r.isSupplier ? "NCC" : null].filter(Boolean).join(" · ") }));
}

/**
 * Số mình còn nợ NCC (`payable`, >0) và số khách còn nợ mình (`receivable`, >0) để gợi ý khi lập phiếu chi/thu.
 * Chỉ trả khi có `debt.view` (không thì `null`); sổ cái: dương = đối tác nợ mình, âm = mình nợ đối tác.
 */
export async function partnerDebtHint(db: Db, actor: Actor, partnerId: number): Promise<{ payable: string; receivable: string } | null> {
  assertCan(actor.perms, "cash.transaction.create");
  if (!actor.perms.has("debt.view")) return null;
  const { balance } = await partnerBalance(db, partnerId);
  return { payable: balance.lt(0) ? balance.neg().toString() : "0", receivable: balance.gt(0) ? balance.toString() : "0" };
}

/** Đơn của khách để thu nợ theo đơn: đơn chính thức chưa hủy, mới nhất trước. */
export async function listPartnerOrders(db: Db, actor: Actor, partnerId: number): Promise<CashOptionDTO[]> {
  assertCan(actor.perms, "cash.transaction.create");
  const rows = await db.saleOrder.findMany({ where: { partnerId, isCancelled: false, isDraft: false }, orderBy: [{ orderDate: "desc" }, { id: "desc" }], take: 30, select: { id: true, code: true, orderDate: true, paymentStatus: true } });
  return rows.map((o) => ({ value: o.id, label: o.code, hint: o.orderDate.toISOString().slice(0, 10) }));
}

export async function listActiveCashAccounts(db: Db): Promise<{ id: number; name: string; type: "CASH" | "BANK" }[]> {
  return db.cashAccount.findMany({ where: { isActive: true }, orderBy: [{ type: "asc" }, { name: "asc" }], select: { id: true, name: true, type: true } });
}

/** Người có thể là "người ứng tiền": người dùng chưa khóa (id dương) + lái xe/phụ xe đang hoạt động (id âm, xem `advancerFields`). */
export async function listAdvancers(db: Db): Promise<{ value: number; label: string }[]> {
  const [users, drivers] = await Promise.all([
    db.user.findMany({ where: { isLocked: false }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    db.driver.findMany({ where: { isActive: true }, select: { id: true, name: true, isAssistant: true }, orderBy: { name: "asc" } }),
  ]);
  return [...users.map((u) => ({ value: u.id, label: u.fullName })), ...drivers.map((d) => ({ value: -d.id, label: `${d.name} (${d.isAssistant ? "phụ xe" : "lái xe"})` }))];
}

// ───────────────────────────── CHI PHÍ HOẠT ĐỘNG (66) ─────────────────────────────
export const EXPENSE_FILTER_KEYS = ["type", "status"] as const;
export interface ExpenseRowDTO { id: number; paymentId: number; code: string; at: Date; expenseTypeId: number; expenseTypeName: string; amount: string; cashAccountName: string; note: string | null; reviewStatus: CashReviewStatus; isCancelled: boolean; createdByName: string | null; advancedByName: string | null }
export interface ExpenseSummaryDTO { total: string; count: number; byType: { expenseTypeId: number; name: string; amount: string }[]; byMonth: { month: string; amount: string }[] }

/** Danh sách chi phí + tổng theo loại và theo tháng (chỉ tính khoản CHƯA hủy, trên toàn bộ tập đã lọc). Lọc: loại chi phí, trạng thái kiểm tra, q (mã phiếu/ghi chú), thời gian. */
export async function listExpenses(db: Db, actor: Actor, params: ListParams, opts: { all?: boolean } = {}): Promise<{ rows: ExpenseRowDTO[]; total: number; summary: ExpenseSummaryDTO }> {
  assertCan(actor.perms, "expense.manage");
  // ghi chú có dấu tiếng Việt: tìm theo chữ người dùng gõ (không bỏ dấu), không phân biệt hoa/thường
  const terms = (params.q ?? "").trim().split(/\s+/).filter(Boolean);
  const range = params.timePreset ? resolveTimeRange(params.timePreset, new Date(), { start: params.timeStart, end: params.timeEnd }) : null;
  const statuses = params.filters.status ?? []; const types = (params.filters.type ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const cancelled = statuses.includes("CANCELLED"); const live = statuses.filter((s) => s !== "CANCELLED") as CashReviewStatus[];
  const paymentWhere: Prisma.PaymentWhereInput = {
    ...(statuses.length === 0 ? {} : { OR: [...(cancelled ? [{ isCancelled: true }] : []), ...(live.length ? [{ isCancelled: false, reviewStatus: { in: live } }] : [])] }),
    ...(range ? { at: timeRangeWhere(range) } : {}),
    AND: terms.map((t) => ({ OR: [{ code: { contains: escapeLike(t.toUpperCase()) } }, { note: { contains: escapeLike(t), mode: "insensitive" as const } }] })),
  };
  const where: Prisma.OperatingExpenseWhereInput = { payment: paymentWhere, ...(types.length ? { expenseTypeId: { in: types } } : {}) };
  const [list, total, liveRows] = await Promise.all([
    db.operatingExpense.findMany({ where, orderBy: [{ payment: { at: "desc" } }, { id: "desc" }], ...(opts.all ? {} : { skip: (params.page - 1) * params.pageSize, take: params.pageSize }), include: { expenseType: { select: { name: true } }, payment: { include: { cashAccount: { select: { name: true } }, advancedByDriver: { select: { name: true } } } } } }),
    db.operatingExpense.count({ where }),
    db.operatingExpense.findMany({ where: { ...where, payment: { ...paymentWhere, isCancelled: false } }, select: { expenseTypeId: true, expenseType: { select: { name: true } }, payment: { select: { amount: true, at: true } } } }),
  ]);
  const names = await fullName(db, list.flatMap((e) => [e.payment.createdBy, ...(e.payment.advancedById ? [e.payment.advancedById] : [])]));
  const byType = new Map<number, { name: string; amount: Prisma.Decimal }>(); const byMonth = new Map<string, Prisma.Decimal>(); let sum = new Prisma.Decimal(0);
  for (const e of liveRows) {
    sum = sum.plus(e.payment.amount);
    const t = byType.get(e.expenseTypeId) ?? { name: e.expenseType.name, amount: new Prisma.Decimal(0) }; t.amount = t.amount.plus(e.payment.amount); byType.set(e.expenseTypeId, t);
    const m = new Date(e.payment.at.getTime() + 7 * 3600_000).toISOString().slice(0, 7); byMonth.set(m, (byMonth.get(m) ?? new Prisma.Decimal(0)).plus(e.payment.amount));
  }
  return {
    total,
    rows: list.map((e) => ({ id: e.id, paymentId: e.paymentId, code: e.payment.code, at: e.payment.at, expenseTypeId: e.expenseTypeId, expenseTypeName: e.expenseType.name, amount: e.payment.amount.toString(), cashAccountName: e.payment.cashAccount.name, note: e.payment.note, reviewStatus: e.payment.reviewStatus, isCancelled: e.payment.isCancelled, createdByName: names.get(e.payment.createdBy) ?? null, advancedByName: e.payment.advancedById ? names.get(e.payment.advancedById) ?? null : e.payment.advancedByDriver?.name ?? null })),
    summary: { total: sum.toString(), count: liveRows.length, byType: [...byType.entries()].map(([expenseTypeId, v]) => ({ expenseTypeId, name: v.name, amount: v.amount.toString() })).sort((a, b) => Number(b.amount) - Number(a.amount)), byMonth: [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([month, amount]) => ({ month, amount: amount.toString() })) },
  };
}

export async function getExpense(db: Db, actor: Actor, id: number) {
  assertCan(actor.perms, "expense.manage");
  const e = await db.operatingExpense.findUnique({ where: { id }, include: { payment: { include: { advancedBy: { select: { id: true, fullName: true } }, advancedByDriver: { select: { id: true, name: true } } } }, expenseType: { select: { name: true } } } });
  if (!e) throw new DomainError("Không tìm thấy khoản chi phí.", 404);
  const at = new Date(e.payment.at.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  return { advancedBy: e.payment.advancedBy ? { value: e.payment.advancedBy.id, label: e.payment.advancedBy.fullName } : e.payment.advancedByDriver ? { value: -e.payment.advancedByDriver.id, label: `${e.payment.advancedByDriver.name} (lái xe)` } : null, id: e.id, paymentId: e.paymentId, code: e.payment.code, expenseTypeId: e.expenseTypeId, cashAccountId: e.payment.cashAccountId, amount: e.payment.amount.toString(), dateYmd: at, note: e.payment.note ?? "", reviewStatus: e.payment.reviewStatus, isCancelled: e.payment.isCancelled };
}

export async function listExpenseTypes(db: Db): Promise<{ id: number; name: string }[]> {
  return db.expenseType.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}
