import { Prisma, type PrismaClient } from "@prisma/client";
import { assertCan } from "@/lib/permissions/guard";
import type { Actor } from "@/lib/permissions/scope";
import { listTimeRange, type ListParams } from "@/lib/query-params";
import { resolveTimeRange, type TimeRange } from "@/lib/time-presets";
import { DomainError } from "@/server/http/errors";
import { DAILY_ITEMS, dailyCanMoney, visibleDailyItems, type DailyItem, type DailyKey } from "./daily-config";

export function dailyRange(params: ListParams, now: Date): TimeRange {
  if (params.timePreset === "custom" && !listTimeRange(params, now)) throw new DomainError("Vui lòng chọn khoảng ngày hợp lệ.", 400);
  return listTimeRange(params, now) ?? resolveTimeRange("today", now)!;
}

export function requireDailyItem(actor: Actor, key: string): DailyItem {
  const item = DAILY_ITEMS.find((i) => i.key === key);
  if (!item) throw new DomainError("Không tìm thấy mục kiểm tra.", 404);
  assertCan(actor.perms, item.perm);
  return item;
}

export interface DailyRow {
  id: number; code: string; at: Date; partner: string; related: string; href: string | null;
  cancelled: boolean; status: string; note: string;
  amount: string | null; extra: string | null;
}
interface RawRow extends Omit<DailyRow, "amount" | "extra"> { amount: Prisma.Decimal | null; extra: Prisma.Decimal | null }
export interface DailyTotals { count: number; cancelled: number; amount: string | null; extra: string | null }
export interface DailySummary { item: DailyItem; totals: DailyTotals | null }

/** Amount meanings are explicit: never add these columns across different business categories. */
export function dailyAmountLabels(key: DailyKey): [string, string | null] {
  switch (key) {
    case "debt": return ["Tăng số dư công nợ", "Giảm số dư công nợ"];
    case "discount-orders": return ["Chiết khấu trực tiếp", "Chiết khấu tích lũy"];
    case "settlements": return ["Chi tiền", "Trừ công nợ"];
    case "loss": return ["Giá vốn hao hụt / xuất hủy", null];
    case "purchases": return ["Tiền hàng", "Cước nhập hàng"];
    default: return ["Giá trị", null];
  }
}

/** All SQL fragments are code-owned; search, filters, range and scope are bound parameters. One row = one document. */
function source(actor: Actor, key: DailyKey): Prisma.Sql {
  const scope = actor.perms.has("partner.view_all") ? Prisma.empty : Prisma.sql`AND p."ownerUserId" = ${actor.userId}`;
  if (key.startsWith("return-") || key === "undelivered") {
    const kind = key === "return-product" ? "BY_PRODUCT" : key === "return-supplier" ? "SUPPLIER" : "BY_ORDER";
    return Prisma.sql`SELECT r.id, r.code, r.at, p.name AS partner, COALESCE(o.code,'') AS related,
      '/returns/' || r.id AS href, r."isCancelled" AS cancelled, CASE WHEN r."isCancelled" THEN 'Đã hủy' ELSE 'Đã ghi sổ' END AS status,
      COALESCE(r.note,'') AS note, r."totalAmount" AS amount, NULL::numeric AS extra, r.kind::text AS type, ''::text AS method
      FROM goods_returns r JOIN partners p ON p.id = r."partnerId" LEFT JOIN sale_orders o ON o.id = r."orderId"
      WHERE r.kind::text = ${kind} AND r.undelivered = ${key === "undelivered"} ${key === "return-supplier" ? Prisma.empty : scope}`;
  }
  switch (key) {
    case "debt": return Prisma.sql`SELECT r.id, r.code, r.at, p.name AS partner,
      CASE r.reason::text WHEN 'HANG_LOI' THEN 'Hàng lỗi' WHEN 'BEP_MOP' THEN 'Hàng bẹp, móp' WHEN 'CHIET_KHAU' THEN 'Trừ bằng chiết khấu tích lũy' ELSE 'Khác' END AS related,
      NULL::text AS href, r."isCancelled" AS cancelled, CASE WHEN r."isCancelled" THEN 'Đã hủy' ELSE 'Đã ghi sổ' END AS status,
      r.note, GREATEST(r.amount,0) AS amount, GREATEST(-r.amount,0) AS extra, ''::text AS type, ''::text AS method
      FROM debt_adjustments r JOIN partners p ON p.id = r."partnerId" WHERE true ${scope}`;
    case "discount-orders": return Prisma.sql`SELECT o.id, o.code, o."orderDate" AS at, p.name AS partner, ''::text AS related,
      '/sales/orders/' || o.id AS href, o."isCancelled" AS cancelled, CASE WHEN o."isCancelled" THEN 'Đã hủy' ELSE 'Đã xác nhận' END AS status,
      COALESCE(o.note,'') AS note, d.amount, d.extra, ''::text AS type, ''::text AS method
      FROM sale_orders o JOIN partners p ON p.id = o."partnerId"
      JOIN LATERAL (SELECT SUM(l."discountNow") AS amount, SUM(l."discountAccum") AS extra FROM sale_order_lines l WHERE l."orderId" = o.id) d ON true
      WHERE NOT o."isDraft" AND (d.amount > 0 OR d.extra > 0) ${scope}`;
    case "settlements": return Prisma.sql`SELECT r.id, r.code, r.at, p.name AS partner,
      CASE WHEN r.method::text = 'CASH' THEN 'Chi tiền' ELSE 'Trừ công nợ' END || CASE WHEN pm.code IS NULL THEN '' ELSE ' · ' || pm.code END AS related,
      '/accounting/discounts/' || p.id AS href, r."isCancelled" AS cancelled,
      CASE WHEN r."isCancelled" THEN 'Đã hủy' WHEN EXISTS (SELECT 1 FROM discount_ledger l WHERE l."docType" = 'DISCOUNT_SETTLE' AND l."docId" = r.id AND l."isReconciled") THEN 'Đã hậu kiểm' ELSE 'Chờ hậu kiểm' END AS status,
      COALESCE(r.note,'') AS note, CASE WHEN r.method::text = 'CASH' THEN r.amount ELSE 0 END AS amount,
      CASE WHEN r.method::text = 'OFFSET' THEN r.amount ELSE 0 END AS extra, ''::text AS type, r.method::text AS method
      FROM discount_settlements r JOIN partners p ON p.id = r."partnerId" LEFT JOIN payments pm ON pm.id = r."paymentId" WHERE true ${scope}`;
    case "loss": return Prisma.sql`SELECT r.id, r.code, r.at, ''::text AS partner,
      CASE WHEN r.type::text = 'LOSS' THEN 'Hao hụt' ELSE 'Xuất hủy' END AS related,
      '/inventory/adjustments/' || r.id AS href, r."isCancelled" AS cancelled,
      CASE WHEN r."isCancelled" THEN 'Đã hủy' ELSE 'Đã ghi sổ' END AS status, COALESCE(r.note,'') AS note,
      CASE WHEN r."isCancelled" THEN NULL::numeric ELSE (SELECT COALESCE(SUM(c.qty * c."unitCost"),0) FROM stock_adjustment_lines l JOIN cost_consumptions c ON c."docLineId" = l.id AND c."docType"::text = CASE WHEN r.type::text = 'LOSS' THEN 'ADJ_LOSS' ELSE 'WRITE_OFF' END WHERE l."adjustmentId" = r.id) END AS amount,
      NULL::numeric AS extra, r.type::text AS type, ''::text AS method
      FROM stock_adjustments r WHERE r.type::text IN ('LOSS','WRITE_OFF')`;
    case "receipts": return Prisma.sql`SELECT r.id, r.code, r.at, COALESCE(p.name,'') AS partner, a.name AS related,
      '/accounting/receipts/' || r.id AS href, r."isCancelled" AS cancelled,
      CASE WHEN r."isCancelled" THEN 'Đã hủy' WHEN r."reviewStatus"::text = 'REVIEWED' THEN 'Đã kiểm tra' WHEN r."reviewStatus"::text = 'RETURNED' THEN 'Trả lại' ELSE 'Chờ kiểm tra' END AS status,
      COALESCE(r.note,'') AS note, r.amount, NULL::numeric AS extra, r.type::text AS type, ''::text AS method
      FROM receipts r LEFT JOIN partners p ON p.id = r."partnerId" JOIN cash_accounts a ON a.id = r."cashAccountId"`;
    case "payments": return Prisma.sql`SELECT r.id, r.code, r.at, COALESCE(p.name,'') AS partner, a.name AS related,
      '/accounting/payments/' || r.id AS href, r."isCancelled" AS cancelled,
      CASE WHEN r."isCancelled" THEN 'Đã hủy' WHEN r."reviewStatus"::text = 'REVIEWED' THEN 'Đã kiểm tra' WHEN r."reviewStatus"::text = 'RETURNED' THEN 'Trả lại' ELSE 'Chờ kiểm tra' END AS status,
      COALESCE(r.note,'') AS note, r.amount, NULL::numeric AS extra, r.kind::text AS type, ''::text AS method
      FROM payments r LEFT JOIN partners p ON p.id = r."partnerId" JOIN cash_accounts a ON a.id = r."cashAccountId"`;
    case "purchases": return Prisma.sql`SELECT r.id, r.code, r.at, p.name AS partner, ''::text AS related,
      '/purchase/orders/' || r.id AS href, r."isCancelled" AS cancelled, CASE WHEN r."isCancelled" THEN 'Đã hủy' ELSE 'Đã nhập kho' END AS status,
      COALESCE(r.note,'') AS note, r."purchaseTotal" AS amount, r."freightCost" AS extra, ''::text AS type, ''::text AS method
      FROM purchases r JOIN partners p ON p.id = r."partnerId"`;
    default: throw new DomainError("Không tìm thấy mục kiểm tra.", 404);
  }
}

export function dailyWhere(key: DailyKey, params: ListParams, range: TimeRange): Prisma.Sql {
  const conditions = [Prisma.sql`d.at >= ${range.start} AND d.at < ${range.end}`];
  const states = params.filters.state ?? ["active"];
  if (!(states.includes("active") && states.includes("cancelled"))) conditions.push(Prisma.sql`d.cancelled = ${states.includes("cancelled")}`);
  // ASSUMPTION: default loss report excludes write-offs; users can explicitly select either/both.
  if (key === "loss") {
    const types = (params.filters.type ?? ["LOSS"]).filter((v) => v === "LOSS" || v === "WRITE_OFF");
    conditions.push(Prisma.sql`d.type IN (${Prisma.join(types.length ? types : ["LOSS"])})`);
  }
  if (key === "settlements") {
    const methods = (params.filters.method ?? []).filter((v) => v === "CASH" || v === "OFFSET");
    if (methods.length) conditions.push(Prisma.sql`d.method IN (${Prisma.join(methods)})`);
  }
  for (const term of (params.q ?? "").split(/\s+/).filter(Boolean)) {
    const pattern = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(Prisma.sql`(d.code ILIKE ${pattern} OR d.partner ILIKE ${pattern} OR d.related ILIKE ${pattern} OR d.note ILIKE ${pattern})`);
  }
  return Prisma.join(conditions, " AND ");
}

export async function loadDailyItem(db: PrismaClient, actor: Actor, key: string, params: ListParams, now: Date, opts: { summaryOnly?: boolean; export?: boolean } = {}) {
  const item = requireDailyItem(actor, key);
  const range = dailyRange(params, now), money = dailyCanMoney(actor, item);
  const query = Prisma.sql`WITH source AS (${source(actor, item.key)}) SELECT * FROM source d WHERE ${dailyWhere(item.key, params, range)}`;
  const work = async (tx: Prisma.TransactionClient) => {
    const [totals] = await tx.$queryRaw<{ count: bigint; cancelled: bigint; amount: Prisma.Decimal; extra: Prisma.Decimal }[]>`
      SELECT COUNT(*) AS count, COUNT(*) FILTER (WHERE cancelled) AS cancelled,
      COALESCE(SUM(amount) FILTER (WHERE NOT cancelled),0) AS amount, COALESCE(SUM(extra) FILTER (WHERE NOT cancelled),0) AS extra FROM (${query}) f`;
    if (opts.export && Number(totals.count) > 10000) throw new DomainError("Báo cáo vượt 10.000 chứng từ. Hãy thu hẹp khoảng ngày hoặc bộ lọc rồi xuất lại.", 400);
    const page = Math.max(1, Math.min(params.page, Math.ceil(Number(totals.count) / params.pageSize)));
    const limit = opts.export ? Prisma.sql`LIMIT 10000` : Prisma.sql`LIMIT ${params.pageSize} OFFSET ${(page - 1) * params.pageSize}`;
    const rows = opts.summaryOnly ? [] : await tx.$queryRaw<RawRow[]>`${query} ORDER BY at DESC, id DESC ${limit}`;
    return { item, range, page, totals: { count: Number(totals.count), cancelled: Number(totals.cancelled), amount: money ? totals.amount.toString() : null, extra: money ? totals.extra.toString() : null },
      rows: rows.map((r): DailyRow => ({ id: r.id, code: r.code, at: r.at, partner: r.partner, related: r.related, href: r.href, cancelled: r.cancelled, status: r.status, note: r.note,
        amount: money ? r.amount?.toString() ?? null : null, extra: money ? r.extra?.toString() ?? null : null })) };
  };
  // Count, totals and page/export see the same database snapshot.
  return db.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
}

export async function loadDailySummary(db: PrismaClient, actor: Actor, params: ListParams, now: Date): Promise<DailySummary[]> {
  dailyRange(params, now);
  return Promise.all(visibleDailyItems(actor).map(async (item) => {
    try { return { item, totals: (await loadDailyItem(db, actor, item.key, params, now, { summaryOnly: true })).totals }; }
    catch (error) { console.error(`[home] daily ${item.key}`, error); return { item, totals: null }; }
  }));
}

/** Current unresolved orders, distinct from return documents in the selected date range. Partial returns remain pending. */
export async function pendingUndeliveredCount(db: PrismaClient, actor: Actor): Promise<number> {
  assertCan(actor.perms, "trip.manage");
  const [r] = await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM sale_orders o
    WHERE NOT o."isCancelled" AND NOT o."isDraft"
    AND EXISTS (SELECT 1 FROM trip_orders t JOIN trips tr ON tr.id = t."tripId" WHERE t."orderId" = o.id AND t.result::text IN ('KHONG_GIAO','GIAO_MOT_PHAN') AND tr.status::text <> 'CANCELLED')
    AND EXISTS (SELECT 1 FROM sale_order_lines l WHERE l."orderId" = o.id AND l.qty >
      COALESCE((SELECT SUM(dl.qty) FROM delivery_lines dl JOIN delivery_notes dn ON dn.id = dl."deliveryNoteId" WHERE dl."orderLineId" = l.id AND NOT dn."isCancelled"),0)
      + COALESCE((SELECT SUM(rl.qty) FROM goods_return_lines rl JOIN goods_returns gr ON gr.id = rl."returnId" WHERE rl."orderLineId" = l.id AND gr.undelivered AND NOT gr."isCancelled"),0))`;
  return Number(r.count);
}
