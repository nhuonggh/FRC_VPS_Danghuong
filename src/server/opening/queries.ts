import type { Prisma, PrismaClient } from "@prisma/client";
import { getOpenPeriod } from "@/server/period/guard";
import type { OpeningKind } from "./registry";

type Db = Prisma.TransactionClient | PrismaClient;
export interface OpeningRowDTO { id: number; code: string; name: string; qty?: string; unitCost?: string; amount: string }
export interface OpeningListDTO { rows: OpeningRowDTO[]; total: string; periodName: string; hasDocs: boolean }

/** Danh sách số đầu kỳ đã nhập của kỳ đang mở (+ tổng) để kế toán đối chiếu với sổ cũ. */
export async function listOpening(db: Db, kind: OpeningKind): Promise<OpeningListDTO> {
  const p = await getOpenPeriod(db); const period = await db.period.findUniqueOrThrow({ where: { id: p.id }, select: { name: true } });
  const where = { periodId: p.id }; let rows: OpeningRowDTO[];
  if (kind === "stock" || kind === "material") {
    const list = await db.openingStock.findMany({ where: { ...where, product: kind === "material" ? { kind: "NVL" } : { kind: { not: "NVL" } } }, orderBy: { product: { code: "asc" } }, select: { id: true, qty: true, unitCost: true, product: { select: { code: true, name: true } } } });
    rows = list.map((r) => ({ id: r.id, code: r.product.code, name: r.product.name, qty: r.qty.toString(), unitCost: r.unitCost.toString(), amount: r.qty.mul(r.unitCost).toDecimalPlaces(0).toString() }));
  } else if (kind === "cash") {
    rows = (await db.openingCash.findMany({ where, orderBy: { cashAccount: { name: "asc" } }, select: { id: true, amount: true, cashAccount: { select: { name: true, bankNo: true } } } })).map((r) => ({ id: r.id, code: r.cashAccount.bankNo ?? "", name: r.cashAccount.name, amount: r.amount.toString() }));
  } else {
    const sel = { id: true, amount: true, partner: { select: { code: true, name: true } } } as const; const orderBy = { partner: { code: "asc" } } as const;
    const list = kind === "debt" ? await db.openingDebt.findMany({ where, orderBy, select: sel }) : await db.openingDiscount.findMany({ where, orderBy, select: sel });
    rows = list.map((r) => ({ id: r.id, code: r.partner.code, name: r.partner.name, amount: r.amount.toString() }));
  }
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const [stock, partner, cash, orders, purchases] = await Promise.all([db.stockLedger.count({ where: { ...where, NOT: { docType: "OPENING" } } }), db.partnerLedger.count({ where }), db.cashLedger.count({ where }), db.saleOrder.count({ where }), db.purchase.count({ where })]);
  return { rows, total: String(total), periodName: period.name, hasDocs: stock + partner + cash + orders + purchases > 0 };
}
