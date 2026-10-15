import type { Prisma, PrismaClient } from "@prisma/client";
import { getOpenPeriod } from "@/server/period/guard";
import type { OpeningKind } from "./registry";

type Db = Prisma.TransactionClient | PrismaClient;
export interface OpeningRowDTO { id: number; code: string; name: string; qty?: string; unitCost?: string; amount: string; isDemo: boolean }
export interface OpeningListDTO { rows: OpeningRowDTO[]; total: string; periodName: string; hasDocs: boolean; /** Số dòng demo / tổng số dòng của loại này (không phụ thuộc bộ lọc). */ demoCount: number; allCount: number }

/** Danh sách số đầu kỳ đã nhập của kỳ đang mở (+ tổng) để kế toán đối chiếu với sổ cũ. */
export async function listOpening(db: Db, kind: OpeningKind, opts: { onlyDemo?: boolean } = {}): Promise<OpeningListDTO> {
  const p = await getOpenPeriod(db); const period = await db.period.findUniqueOrThrow({ where: { id: p.id }, select: { name: true } });
  const base = { periodId: p.id }; const where = opts.onlyDemo ? { ...base, isDemo: true } : base; let rows: OpeningRowDTO[];
  if (kind === "stock" || kind === "material") {
    const list = await db.openingStock.findMany({ where: { ...where, product: kind === "material" ? { kind: "NVL" } : { kind: { not: "NVL" } } }, orderBy: { product: { code: "asc" } }, select: { id: true, qty: true, unitCost: true, isDemo: true, product: { select: { code: true, name: true } } } });
    rows = list.map((r) => ({ id: r.id, code: r.product.code, name: r.product.name, qty: r.qty.toString(), unitCost: r.unitCost.toString(), amount: r.qty.mul(r.unitCost).toDecimalPlaces(0).toString(), isDemo: r.isDemo }));
  } else if (kind === "cash") {
    rows = (await db.openingCash.findMany({ where, orderBy: { cashAccount: { name: "asc" } }, select: { id: true, amount: true, isDemo: true, cashAccount: { select: { name: true, bankNo: true } } } })).map((r) => ({ id: r.id, code: r.cashAccount.bankNo ?? "", name: r.cashAccount.name, amount: r.amount.toString(), isDemo: r.isDemo }));
  } else {
    const sel = { id: true, amount: true, isDemo: true, partner: { select: { code: true, name: true } } } as const; const orderBy = { partner: { code: "asc" } } as const;
    const list = kind === "debt" ? await db.openingDebt.findMany({ where, orderBy, select: sel }) : await db.openingDiscount.findMany({ where, orderBy, select: sel });
    rows = list.map((r) => ({ id: r.id, code: r.partner.code, name: r.partner.name, amount: r.amount.toString(), isDemo: r.isDemo }));
  }
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const [stock, partner, cash, orders, purchases] = await Promise.all([db.stockLedger.count({ where: { ...base, NOT: { docType: "OPENING" } } }), db.partnerLedger.count({ where: base }), db.cashLedger.count({ where: base }), db.saleOrder.count({ where: base }), db.purchase.count({ where: base })]);
  // Đếm demo/tổng theo loại (không theo bộ lọc) để hiện bộ lọc + nút reset
  const stockKind = kind === "material" ? { kind: "NVL" as const } : { kind: { not: "NVL" as const } };
  const count = (extra: { isDemo?: boolean }) => kind === "stock" || kind === "material" ? db.openingStock.count({ where: { ...base, ...extra, product: stockKind } }) : kind === "cash" ? db.openingCash.count({ where: { ...base, ...extra } }) : kind === "debt" ? db.openingDebt.count({ where: { ...base, ...extra } }) : db.openingDiscount.count({ where: { ...base, ...extra } });
  const [demoCount, allCount] = await Promise.all([count({ isDemo: true }), count({})]);
  return { rows, total: String(total), periodName: period.name, hasDocs: stock + partner + cash + orders + purchases > 0, demoCount, allCount };
}
