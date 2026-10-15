import { Prisma } from "@prisma/client";
import { parseViNumber } from "@/lib/parse-number";
import { normalizeSearch } from "@/lib/search";
import type { Actor } from "@/lib/permissions/scope";
import { writeAudit } from "@/server/audit/write";
import type { ImportColumn, ImportSpec } from "@/server/import/types";
import { assertOpeningAllowed } from "./guard";

export type OpeningMoneyKind = "debt" | "discount" | "cash";
export interface OpeningMoneyRow { key: string; targetId: number; amount: string }
interface Ctx { periodId: number; targets: Map<string, number> }
const text = (v: unknown) => (v == null ? "" : String(v).trim());

const META: Record<OpeningMoneyKind, { entity: string; label: string; keyHeader: string; keySample: string; amountHeader: string; amountSample: string; negative: boolean }> = {
  debt: { entity: "OpeningDebt", label: "công nợ đầu kỳ", keyHeader: "Mã đối tác", keySample: "KH001", amountHeader: "Số dư (+ khách nợ, − mình nợ)", amountSample: "12.500.000", negative: true },
  discount: { entity: "OpeningDiscount", label: "chiết khấu tích lũy đầu kỳ", keyHeader: "Mã khách hàng", keySample: "KH001", amountHeader: "Chiết khấu còn nợ khách", amountSample: "1.200.000", negative: false },
  cash: { entity: "OpeningCash", label: "số dư quỹ đầu kỳ", keyHeader: "Tên quỹ / tài khoản", keySample: "Tiền mặt", amountHeader: "Số dư", amountSample: "50.000.000", negative: false },
};
export const openingMoneyColumns = (kind: OpeningMoneyKind): readonly ImportColumn[] => [
  { key: "key", header: META[kind].keyHeader, required: true, sample: META[kind].keySample }, { key: "amount", header: META[kind].amountHeader, aliases: ["Số dư", "Số tiền"], required: true, sample: META[kind].amountSample },
];

/** K2/K3 + chiết khấu tích lũy: ghi bảng opening_*, mỗi đối tác/quỹ một dòng; ghi đè khi bật "Ghi đè". */
export function openingMoneySpec(kind: OpeningMoneyKind, opts: { actor: Actor; force: boolean }): ImportSpec<OpeningMoneyRow, Ctx> {
  const m = META[kind];
  return {
    entity: m.entity, label: m.label, columns: openingMoneyColumns(kind),
    async loadContext(db) {
      const period = await assertOpeningAllowed(db, opts.actor, opts.force);
      if (kind === "cash") { const list = await db.cashAccount.findMany({ where: { isActive: true }, select: { id: true, name: true } }); return { periodId: period.id, targets: new Map(list.map((a) => [normalizeSearch(a.name), a.id])) }; }
      const list = await db.partner.findMany({ where: { mergedIntoId: null, ...(kind === "discount" ? { isCustomer: true } : {}) }, select: { id: true, code: true } });
      return { periodId: period.id, targets: new Map(list.map((p) => [p.code.toUpperCase(), p.id])) };
    },
    parseRow(cells, ctx) {
      const errors: string[] = []; const raw = text(cells.key); const key = kind === "cash" ? normalizeSearch(raw) : raw.toUpperCase(); const targetId = ctx.targets.get(key);
      if (!raw) errors.push(kind === "cash" ? "Thiếu tên quỹ." : "Thiếu mã đối tác."); else if (targetId === undefined) errors.push(kind === "cash" ? `Quỹ "${raw}" chưa có hoặc đã tắt — tạo ở Cài đặt danh mục.` : `Mã "${raw}" chưa có${kind === "discount" ? " trong danh sách khách hàng" : ""} (hoặc đã gộp).`);
      const amount = parseViNumber(cells.amount, { allowNegative: m.negative, maxFrac: 2 }); if (!amount.ok) errors.push(`Số dư: ${amount.message}`); else if (amount.value === null) errors.push("Thiếu số dư.");
      if (errors.length) return { ok: false, errors };
      return { ok: true, data: { key: kind === "cash" ? raw : key, targetId: targetId!, amount: (amount as { value: string }).value } };
    },
    keyOf: (row) => row.key,
    skipReason: (row) => (new Prisma.Decimal(row.amount).isZero() ? "Số dư bằng 0 — không cần nhập." : null),
    async existingKeys(db, keys) {
      const period = await db.period.findFirstOrThrow({ where: { isOpen: true }, select: { id: true } });
      if (kind === "cash") { const rows = await db.openingCash.findMany({ where: { periodId: period.id }, select: { cashAccount: { select: { name: true } } } }); const have = new Set(rows.map((r) => normalizeSearch(r.cashAccount.name))); return new Set(keys.filter((k) => have.has(normalizeSearch(k)))); }
      const where = { periodId: period.id, partner: { code: { in: keys } } }; const sel = { partner: { select: { code: true } } };
      const rows = kind === "debt" ? await db.openingDebt.findMany({ where, select: sel }) : await db.openingDiscount.findMany({ where, select: sel });
      return new Set(rows.map((r) => r.partner.code.toUpperCase()));
    },
    async create(tx, actor, rows, ctx) { await save(tx, actor, kind, ctx.periodId, rows, false); },
    async update(tx, actor, rows, ctx) { await save(tx, actor, kind, ctx.periodId, rows, true); },
  };
}

async function save(tx: Prisma.TransactionClient, actor: Actor, kind: OpeningMoneyKind, periodId: number, rows: OpeningMoneyRow[], overwrite: boolean) {
  for (const r of rows) {
    const amount = new Prisma.Decimal(r.amount); let before: unknown = null; let id: number;
    if (kind === "cash") {
      const where = { periodId_cashAccountId: { periodId, cashAccountId: r.targetId } };
      if (overwrite) before = await tx.openingCash.findUnique({ where, select: { amount: true } });
      id = (await tx.openingCash.upsert({ where, create: { periodId, cashAccountId: r.targetId, amount }, update: { amount, isDemo: false }, select: { id: true } })).id;
    } else {
      const where = { periodId_partnerId: { periodId, partnerId: r.targetId } };
      if (kind === "debt") {
        if (overwrite) before = await tx.openingDebt.findUnique({ where, select: { amount: true } });
        id = (await tx.openingDebt.upsert({ where, create: { periodId, partnerId: r.targetId, amount }, update: { amount, isDemo: false }, select: { id: true } })).id;
      } else {
        if (overwrite) before = await tx.openingDiscount.findUnique({ where, select: { amount: true } });
        id = (await tx.openingDiscount.upsert({ where, create: { periodId, partnerId: r.targetId, amount }, update: { amount, isDemo: false }, select: { id: true } })).id;
      }
    }
    await writeAudit(tx, { userId: actor.userId, action: `opening.${kind}.${overwrite ? "update" : "create"}`, entity: META[kind].entity, entityId: id, before, after: { key: r.key, amount: r.amount } });
  }
}
