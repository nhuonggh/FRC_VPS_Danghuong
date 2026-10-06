import { Prisma, type ProductKind } from "@prisma/client";
import { parseViNumber } from "@/lib/parse-number";
import type { Actor } from "@/lib/permissions/scope";
import { ictStartOfDay, toIct } from "@/lib/time";
import { writeAudit } from "@/server/audit/write";
import type { ImportColumn, ImportSpec } from "@/server/import/types";
import { postReceipt, removeDocument, type EngineCtx } from "@/server/inventory";
import { assertOpeningAllowed } from "./guard";

export type OpeningStockKind = "stock" | "material";
export interface OpeningStockRow { code: string; productId: number; qty: string; unitCost: string }
interface Ctx { periodId: number; openedAt: Date; products: Map<string, { id: number; kind: ProductKind; isActive: boolean }>; existing: Map<number, number> }

const text = (v: unknown) => (v == null ? "" : String(v).trim());
const COLUMNS: readonly ImportColumn[] = [
  { key: "code", header: "Mã", required: true, sample: "SP001" },
  { key: "qty", header: "Số lượng", required: true, sample: "1.250,5" },
  { key: "unitCost", header: "Giá vốn / đơn vị gốc", aliases: ["Giá vốn", "Đơn giá vốn"], required: true, sample: "18.500" },
];

/** K1 (hàng hóa/thành phẩm/phụ kiện) và K4 (NVL): mỗi mã một lô OPENING qua engine, giá vốn nhập tay (D-39). */
export function openingStockSpec(kind: OpeningStockKind, opts: { actor: Actor; force: boolean }): ImportSpec<OpeningStockRow, Ctx> {
  const isMaterial = kind === "material";
  return {
    entity: isMaterial ? "OpeningMaterial" : "OpeningStock", label: isMaterial ? "tồn NVL đầu kỳ" : "tồn kho đầu kỳ", columns: COLUMNS,
    async loadContext(db) {
      const period = await assertOpeningAllowed(db, opts.actor, opts.force);
      const [products, existing] = await Promise.all([
        db.product.findMany({ select: { id: true, code: true, kind: true, isActive: true } }),
        db.openingStock.findMany({ where: { periodId: period.id }, select: { id: true, productId: true } }),
      ]);
      return { periodId: period.id, openedAt: period.openedAt, products: new Map(products.map((p) => [p.code, p])), existing: new Map(existing.map((e) => [e.productId, e.id])) };
    },
    parseRow(cells, ctx) {
      const errors: string[] = []; const code = text(cells.code).toUpperCase(); const product = ctx.products.get(code);
      if (!code) errors.push("Thiếu mã."); else if (!product) errors.push(`Mã "${code}" chưa có trong danh mục sản phẩm.`);
      else if ((product.kind === "NVL") !== isMaterial) errors.push(isMaterial ? `Mã "${code}" không phải nguyên vật liệu — nhập ở màn Tồn kho đầu kỳ.` : `Mã "${code}" là nguyên vật liệu — nhập ở màn Tồn NVL đầu kỳ.`);
      const qty = parseViNumber(cells.qty, { maxFrac: 3 }); if (!qty.ok) errors.push(`Số lượng: ${qty.message}`); else if (!qty.value || new Prisma.Decimal(qty.value).lte(0)) errors.push("Số lượng phải lớn hơn 0.");
      const cost = parseViNumber(cells.unitCost, { maxFrac: 4 }); if (!cost.ok) errors.push(`Giá vốn: ${cost.message}`); else if (cost.value === null) errors.push("Thiếu giá vốn.");
      if (errors.length) return { ok: false, errors };
      return { ok: true, data: { code, productId: product!.id, qty: (qty as { value: string }).value, unitCost: (cost as { value: string }).value } };
    },
    keyOf: (row) => row.code,
    async existingKeys(db, keys) {
      const period = await db.period.findFirstOrThrow({ where: { isOpen: true }, select: { id: true } });
      return new Set((await db.openingStock.findMany({ where: { periodId: period.id, product: { code: { in: keys } } }, select: { product: { select: { code: true } } } })).map((r) => r.product.code));
    },
    engineProducts: (rows) => rows.map((r) => r.productId),
    async create(tx, actor, rows, ctx, engine) { for (const r of rows) await writeLine(tx, actor, ctx, r, engine!, null); },
    async update(tx, actor, rows, ctx, engine) { for (const r of rows) await writeLine(tx, actor, ctx, r, engine!, ctx.existing.get(r.productId) ?? null); },
  };
}

async function writeLine(tx: Prisma.TransactionClient, actor: Actor, ctx: Ctx, r: OpeningStockRow, engine: EngineCtx, existingId: number | null) {
  const o = toIct(ctx.openedAt); const at = ictStartOfDay(o.y, o.m, o.d);
  const data = { qty: new Prisma.Decimal(r.qty), unitCost: new Prisma.Decimal(r.unitCost) };
  let before: unknown = null; let id = existingId;
  if (id !== null) { before = await tx.openingStock.findUniqueOrThrow({ where: { id }, select: { qty: true, unitCost: true } }); await removeDocument(engine, "OPENING", id); await tx.openingStock.update({ where: { id }, data: { ...data, isDemo: false } }); }
  else id = (await tx.openingStock.create({ data: { periodId: ctx.periodId, productId: r.productId, ...data }, select: { id: true } })).id;
  await postReceipt(engine, { productId: r.productId, qty: r.qty, unitCost: r.unitCost, docType: "OPENING", docId: id, docLineId: id, at });
  await writeAudit(tx, { userId: actor.userId, action: existingId === null ? "opening.stock.create" : "opening.stock.update", entity: "OpeningStock", entityId: id, before, after: { code: r.code, qty: r.qty, unitCost: r.unitCost } });
}
