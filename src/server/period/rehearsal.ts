import { Prisma, type PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { parseListParams } from "@/lib/query-params";
import { cashBalance } from "@/server/cash/balance";
import { discountBalance, partnerBalance } from "@/server/debt/balance";
import { onHandList } from "@/server/inventory-reports/on-hand";
import { getOpenPeriod } from "./guard";

/**
 * Số liệu của KỲ ĐANG MỞ đọc bằng đúng các hàm báo cáo của ứng dụng (tồn hiện tại, công nợ, quỹ, chiết khấu) — dùng cho diễn
 * tập kết sổ: chụp trước, kết sổ, chụp sau, rồi so. Đường đọc này ĐỘC LẬP với bước tự kiểm bên trong engine kết sổ
 * (`verifyOpening` so từng lô từ bảng), nên hai đường cùng ra một số mới đáng tin.
 */
export interface PeriodTotals {
  periodId: number;
  stock: Record<string, { qty: string; value: string }>; // theo mã hàng
  debt: Record<string, string>; // theo đối tác
  cash: Record<string, string>; // theo quỹ
  discount: Record<string, string>; // theo đối tác
}

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export async function captureTotals(db: PrismaClient, actor: Actor): Promise<PeriodTotals> {
  const period = await getOpenPeriod(db);
  const [{ rows }, partners, accounts] = await Promise.all([
    onHandList(db, actor, parseListParams({}), { unpaged: true }),
    db.partner.findMany({ select: { id: true } }),
    db.cashAccount.findMany({ select: { id: true } }),
  ]);
  const totals: PeriodTotals = { periodId: period.id, stock: {}, debt: {}, cash: {}, discount: {} };
  for (const r of rows) if (!D(r.onHand).isZero()) totals.stock[r.code] = { qty: D(r.onHand).toString(), value: D(r.stockValue ?? 0).toFixed(2) };
  for (const p of partners) {
    const [debt, disc] = await Promise.all([partnerBalance(db, p.id), discountBalance(db, p.id)]);
    if (!debt.balance.isZero()) totals.debt[String(p.id)] = debt.balance.toFixed(2);
    if (!disc.isZero()) totals.discount[String(p.id)] = disc.toFixed(2);
  }
  for (const a of accounts) {
    const b = (await cashBalance(db, period.id, a.id)).balance;
    if (!b.isZero()) totals.cash[String(a.id)] = b.toFixed(2);
  }
  return totals;
}

export interface TotalsDiff { what: string; key: string; before: string; after: string }

/** Mọi khác biệt giữa hai lần chụp (bỏ qua `periodId`). Rỗng = trước và sau kết sổ bằng nhau. */
export function diffTotals(before: PeriodTotals, after: PeriodTotals): TotalsDiff[] {
  const out: TotalsDiff[] = [];
  const cmp = (what: string, a: Record<string, string>, b: Record<string, string>) => {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const [x, y] = [a[key] ?? "0", b[key] ?? "0"];
      if (!D(x).equals(y)) out.push({ what, key, before: x, after: y });
    }
  };
  for (const key of new Set([...Object.keys(before.stock), ...Object.keys(after.stock)])) {
    const [x, y] = [before.stock[key] ?? { qty: "0", value: "0" }, after.stock[key] ?? { qty: "0", value: "0" }];
    if (!D(x.qty).equals(y.qty)) out.push({ what: "tồn (số lượng)", key, before: x.qty, after: y.qty });
    if (!D(x.value).equals(y.value)) out.push({ what: "tồn (giá trị)", key, before: x.value, after: y.value });
  }
  cmp("công nợ", before.debt, after.debt);
  cmp("quỹ", before.cash, after.cash);
  cmp("chiết khấu tích lũy", before.discount, after.discount);
  return out;
}
