import { Prisma, type ProductKind } from "@prisma/client";
import type { Actor } from "@/lib/permissions/scope";
import { normalizeSearch } from "@/lib/search";
import type { ImportColumn, ImportSpec } from "@/server/import/types";
import { assertOpeningAllowed } from "./guard";
import { type OpeningStockCtx, type OpeningStockKind, type OpeningStockRow, openingStockSpec, writeLine } from "./stock";

interface LegacyProduct { id: number; code: string; name: string; kind: ProductKind; minStock: Prisma.Decimal; purchasePrice: Prisma.Decimal | null }
interface LegacyCtx extends OpeningStockCtx { byName: Map<string, LegacyProduct[]> }
interface LegacyRow extends OpeningStockRow { name: string; skip: string | null }

const text = (v: unknown) => (v == null ? "" : String(v).trim());
/** Cột của báo cáo "Định mức tồn" xuất từ phần mềm cũ (số ở dạng `4220.0000`, dấu chấm là thập phân). */
export const LEGACY_STOCK_COLUMNS: readonly ImportColumn[] = [
  { key: "name", header: "Tên sản phẩm", required: true, sample: "Hộp mạ kẽm 25*50*1.1" },
  { key: "qty", header: "Số lượng còn", aliases: ["Số lượng"], required: true, sample: "4220.0000" },
  { key: "minStock", header: "Định mức tồn kho", aliases: ["Định mức tồn"], sample: "750.0000" },
];

function decimal(v: unknown): Prisma.Decimal | null | "bad" {
  const s = text(v).replace(/,/g, ""); if (!s) return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return "bad";
  return new Prisma.Decimal(s);
}
const plain = (d: Prisma.Decimal) => d.toFixed().replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

/**
 * Nhập tồn đầu kỳ thẳng từ tệp "Định mức tồn" của phần mềm cũ: khớp sản phẩm theo TÊN (không dấu, không phân biệt hoa thường),
 * giá vốn lấy từ Giá nhập mặc định của sản phẩm (thiếu ⇒ 0 và có cảnh báo), tuỳ chọn cập nhật Định mức tồn.
 * Tệp trộn cả hàng lẫn NVL nên mỗi màn chỉ nhận sản phẩm đúng loại của nó, dòng còn lại bị bỏ qua.
 */
export function openingLegacyStockSpec(kind: OpeningStockKind, opts: { actor: Actor; force: boolean; updateMinStock: boolean }): ImportSpec<LegacyRow, LegacyCtx> {
  const isMaterial = kind === "material"; const base = openingStockSpec(kind, opts);
  return {
    entity: base.entity, label: base.label, columns: LEGACY_STOCK_COLUMNS,
    async loadContext(db) {
      const period = await assertOpeningAllowed(db, opts.actor, opts.force);
      const [products, existing] = await Promise.all([
        db.product.findMany({ select: { id: true, code: true, name: true, kind: true, isActive: true, minStock: true, purchasePrice: true } }),
        db.openingStock.findMany({ where: { periodId: period.id }, select: { id: true, productId: true } }),
      ]);
      const byName = new Map<string, LegacyProduct[]>();
      for (const p of products) { const k = normalizeSearch(p.name); byName.set(k, [...(byName.get(k) ?? []), p]); }
      return { periodId: period.id, openedAt: period.openedAt, products: new Map(products.map((p) => [p.code, p])), existing: new Map(existing.map((e) => [e.productId, e.id])), byName };
    },
    parseRow(cells, ctx) {
      const name = text(cells.name); const errors: string[] = [];
      if (!name) return { ok: false, errors: ["Thiếu tên sản phẩm."] };
      const qty = decimal(cells.qty); const min = decimal(cells.minStock);
      if (qty === "bad" || qty === null) errors.push("Số lượng không hợp lệ."); else if (qty.isNeg()) errors.push("Số lượng không được âm.");
      if (min === "bad" || (min !== null && min.isNeg())) errors.push("Định mức tồn không hợp lệ.");
      if (errors.length) return { ok: false, errors };
      const q = (qty as Prisma.Decimal).toDecimalPlaces(3); const m = min === null ? null : (min as Prisma.Decimal).toDecimalPlaces(3);
      const wantsMin = opts.updateMinStock && m !== null; const found = ctx.byName.get(normalizeSearch(name)) ?? [];
      if (found.length === 0) {
        if (q.isZero() && !wantsMin) return { ok: true, data: { name, code: "", productId: 0, qty: "0", unitCost: "0", skip: "Tồn bằng 0 và không có trong danh mục." } };
        return { ok: false, errors: [`Chưa có sản phẩm tên "${name}" trong danh mục — thêm sản phẩm hoặc sửa tên cho khớp.`] };
      }
      if (found.length > 1) return { ok: false, errors: [`Tên trùng ${found.length} sản phẩm (${found.map((p) => p.code).join(", ")}) — nhập các mã này bằng tệp mẫu theo mã.`] };
      const p = found[0]!; const other = (p.kind === "NVL") !== isMaterial;
      const data: LegacyRow = { name, code: p.code, productId: p.id, qty: plain(q), unitCost: "0", minStock: wantsMin ? plain(m!) : null, skip: null };
      if (other) { data.skip = isMaterial ? `"${p.code}" là hàng hóa — nhập ở màn Tồn kho đầu kỳ.` : `"${p.code}" là nguyên vật liệu — nhập ở màn Tồn NVL đầu kỳ.`; return { ok: true, data }; }
      const notes: string[] = [];
      if (q.isZero()) { if (!wantsMin) data.skip = "Tồn bằng 0."; else notes.push("Tồn 0 — chỉ cập nhật Định mức tồn."); }
      else {
        if (!q.eq(qty as Prisma.Decimal)) notes.push(`Số lượng làm tròn còn 3 số lẻ (${plain(qty as Prisma.Decimal)} → ${plain(q)}).`);
        if (p.purchasePrice && p.purchasePrice.gt(0)) data.unitCost = plain(p.purchasePrice);
        else notes.push("CẢNH BÁO: chưa có giá nhập mặc định — giá vốn = 0, cần cập nhật sau (lãi bán hàng sẽ ảo).");
      }
      if (wantsMin && !p.minStock.eq(m!)) notes.push(`Định mức tồn ${plain(p.minStock)} → ${plain(m!)}.`);
      return { ok: true, data, warning: notes.join(" ") || undefined };
    },
    keyOf: (row) => row.code || `tên: ${normalizeSearch(row.name)}`,
    skipReason: (row) => row.skip,
    existingKeys: (db, keys) => base.existingKeys(db, keys),
    engineProducts: (rows) => rows.map((r) => r.productId),
    async create(tx, actor, rows, ctx, engine) { for (const r of rows) await writeLine(tx, actor, ctx, r, engine!, null); },
    async update(tx, actor, rows, ctx, engine) { for (const r of rows) await writeLine(tx, actor, ctx, r, engine!, ctx.existing.get(r.productId) ?? null); },
  };
}
