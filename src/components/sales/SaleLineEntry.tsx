"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Combobox, type ComboOption } from "@/components/ui";
import { igCombo, igInput, InlineField } from "@/components/sales/InlineField";
import type { TypeOption } from "@/components/sales/QuickDimensionEntry";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatQty } from "@/lib/format";
import { parseLengthExpr, pricePerM2, pricePerMd, termNote, termQty } from "@/lib/length-expr";
import type { ProductOption } from "@/server/products/queries";
import type { SalePricingDTO } from "@/server/sales/pricing";
import type { SaleOrderInput } from "@/server/sales/schemas";

const LABEL = "sm:min-w-40";
const num = (v: string) => Number(v.replace(",", ".")) || 0;
const info = "flex min-h-11 items-center gap-2 rounded-sm border border-dashed border-border bg-canvas px-3 text-sm md:min-h-9";

/**
 * Dải "Thông tin sản phẩm" của form lập đơn (như màn bán hàng cũ): Kho → Tên sản phẩm → (tồn, giá) → Kiểu gia công →
 * Chiều dài / Số lượng / Đơn giá → Ghi chú → "Thêm vào đơn". Chiều dài dạng `7.1*7+6.8*1` sinh mỗi số hạng một dòng
 * (SL tính theo md = đơn vị gốc, nên kho/BOM/FIFO không đổi); bỏ trống thì thêm 1 dòng theo SL × đơn giá.
 */
export function SaleLineEntry({ loadProducts, pricingPartnerId, canEditPrice, disabled, warehouses, warehouseId, onWarehouse, onAdd }: {
  loadProducts: (q: string) => Promise<ProductOption[]>; pricingPartnerId: number | null | undefined; canEditPrice: boolean; disabled: boolean;
  warehouses: ComboOption[]; warehouseId: number | null; onWarehouse: (id: number | null) => void;
  onAdd: (product: ProductOption, rows: SaleOrderInput["lines"]) => void;
}) {
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [ratioInput, setRatioInput] = useState("1"); // chưa có tỷ lệ ⇒ mặc định 1, lưu cho lần sau
  const [unit, setUnit] = useState("");
  const [len, setLen] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [dto, setDto] = useState<SalePricingDTO | null>(null);
  const [pickKey, setPickKey] = useState(0);

  const reset = () => { setProduct(null); setTypes([]); setTypeId(null); setUnit(""); setLen(""); setQty("1"); setPrice(""); setPriceTouched(false); setNote(""); setError(""); setDto(null); setPickKey((k) => k + 1); };
  const pickProduct = (o: ComboOption | null) => {
    const p = o as ProductOption | null;
    if (!p) { reset(); return; }
    setProduct(p); setTypes([]); setTypeId(null); setUnit(p.baseUnit); setLen(""); setQty("1"); setPrice(""); setPriceTouched(false); setNote(""); setError(""); setDto(null);
    apiFetch<TypeOption[]>(`/api/orders/options/processing-types?productId=${p.value}`).then(setTypes).catch(() => setTypes([]));
  };

  const currentType = typeId ? types.find((t) => Number(t.value) === typeId) ?? null : null;
  const ratioKnown = !!currentType?.ratio;
  const ratio = currentType?.ratio ?? (Number(ratioInput.replace(",", ".")) || 0);
  const useLength = len.trim() !== "";

  // Tồn + giá gần nhất (theo đúng kiểu gia công đang chọn); đổi khách → tải lại
  useEffect(() => {
    if (!product || !pricingPartnerId) { setDto(null); return; }
    let live = true;
    apiFetch<SalePricingDTO | null>(`/api/orders/pricing?partnerId=${pricingPartnerId}&productId=${product.value}${typeId ? `&processingTypeId=${typeId}` : ""}`)
      .then((d) => { if (live) setDto(d); }).catch(() => { if (live) setDto(null); });
    return () => { live = false; };
  }, [product?.value, typeId, pricingPartnerId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Giá gợi ý: chưa sửa tay thì điền giá gần nhất của đơn vị đang chọn (dòng chiều dài luôn tính theo đơn vị gốc); không có quyền sửa giá thì luôn ép theo gợi ý
  useEffect(() => {
    const u = useLength ? product?.baseUnit : unit;
    const s = dto?.units.find((x) => x.unit === u)?.suggestedPrice;
    if (s != null && (!priceTouched || !canEditPrice)) setPrice(String(Number(s)));
  }, [dto, unit, useLength]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!product) { setError("Chọn sản phẩm trước khi thêm vào đơn."); return; }
    if (price.trim() === "" || num(price) < 0) { setError(canEditPrice ? "Nhập đơn giá." : "Chưa có giá bán tham chiếu — nhờ người có quyền sửa giá nhập lần đầu."); return; }
    if (useLength) {
      const parsed = parseLengthExpr(len);
      if ("error" in parsed) { setError(parsed.error); return; }
      if (!typeId) { setError("Chọn kiểu gia công để nhập theo chiều dài."); return; }
      if (!(ratio > 0)) { setError("Nhập tỷ lệ m²/md."); return; }
      if (!ratioKnown) {
        try {
          const r = await apiFetch<{ ratio: string }>("/api/orders/processing-ratio", { method: "POST", json: { productId: product.value, processingTypeId: typeId, ratio } });
          setTypes((all) => all.map((t) => (Number(t.value) === typeId ? { ...t, ratio: Number(r.ratio) } : t)));
        } catch (e) { setError(e instanceof Error ? e.message : "Không lưu được tỷ lệ."); return; }
      }
      const rows = parsed.terms.map((t) => ({
        productId: product.value, unit: product.baseUnit, qty: termQty(t), salePrice: num(price), discountNow: 0, discountAccum: 0, processingTypeId: typeId,
        note: [note.trim(), termNote(t, ratio)].filter(Boolean).join(" — "),
      }));
      onAdd(product, rows as SaleOrderInput["lines"]);
    } else {
      if (!(num(qty) > 0)) { setError("Số lượng phải lớn hơn 0."); return; }
      onAdd(product, [{ productId: product.value, unit, qty: num(qty), salePrice: num(price), discountNow: 0, discountAccum: 0, processingTypeId: typeId, note: note.trim() }] as SaleOrderInput["lines"]);
    }
    reset();
  };

  return (
    <div className="grid gap-x-6 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
      <InlineField id="se-wh" label="Kho xuất" labelClass={LABEL} className="xl:col-span-2">
        <select id="se-wh" value={warehouseId ?? ""} onChange={(e) => onWarehouse(e.target.value ? Number(e.target.value) : null)} className={`${igInput} cursor-pointer`}>
          <option value="">— Không chọn —</option>
          {warehouses.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
        </select>
      </InlineField>
      <span className="hidden xl:block" />

      <InlineField id="se-product" label="Tên sản phẩm" labelClass={LABEL} className="xl:col-span-2">
        <div className={igCombo}><Combobox key={pickKey} hideLabel label="Tên sản phẩm" value={product} loadOptions={loadProducts} placeholder="Tìm sản phẩm (mã, tên…)" onChange={pickProduct} disabled={disabled} /></div>
      </InlineField>
      {product ? (
        <p className={info} role="status">
          {dto?.onHand !== undefined ? <>Còn tồn <b className="tabular">{formatQty(dto.onHand)}</b> {dto.baseUnit}</> : <span className="text-fg-muted">{pricingPartnerId ? "Đang tải tồn…" : "Chọn khách hàng để xem tồn, giá gợi ý"}</span>}
        </p>
      ) : <span className="hidden xl:block" />}

      {product && (<>
        <p className={`${info} justify-between`}>
          <span>Giá nhập gần nhất</span>
          <b className="tabular">{dto?.lastPurchasePrice != null ? formatCurrency(dto.lastPurchasePrice) : "—"}</b>
        </p>
        <InlineField id="se-type" label="Kiểu gia công" labelClass={LABEL}>
          <select id="se-type" value={typeId ?? ""} onChange={(e) => { setTypeId(e.target.value ? Number(e.target.value) : null); setPriceTouched(false); setError(""); }} className={`${igInput} cursor-pointer`}>
            <option value="">Không</option>
            {types.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </InlineField>
        <p className={`${info} justify-between`}>
          <span>Giá bán gần nhất{dto?.lastSalePrice != null ? (dto.lastSalePriceForPartner ? " (khách này)" : " (khách khác)") : ""}</span>
          <b className="tabular">{dto?.lastSalePrice != null ? `${formatCurrency(dto.lastSalePrice)}/${dto.baseUnit}` : "—"}</b>
        </p>

        <InlineField id="se-len" label="Chiều dài" labelClass={LABEL}>
          <input id="se-len" value={len} onChange={(e) => { setLen(e.target.value); setError(""); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }} placeholder="7.1*7+6.8*1" autoComplete="off" className={igInput} />
        </InlineField>
        <InlineField id="se-qty" label="Số lượng" labelClass={LABEL}>
          <input id="se-qty" inputMode="decimal" value={useLength ? "" : qty} disabled={useLength} placeholder={useLength ? "Tính từ chiều dài" : "1"} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }} className={`${igInput} tabular text-right`} />
          <select aria-label="Đơn vị tính" value={useLength ? product.baseUnit : unit} disabled={useLength} onChange={(e) => { setUnit(e.target.value); setPriceTouched(false); }} className="h-11 shrink-0 cursor-pointer border-l border-border bg-hover px-2 text-sm outline-none disabled:opacity-60 md:h-9">
            {(product.units ?? []).map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
          </select>
        </InlineField>
        <InlineField id="se-price" label={useLength ? "Đơn giá/md" : "Đơn giá"} labelClass={LABEL}>
          <input id="se-price" type="number" min={0} step="any" readOnly={!canEditPrice} value={price} onChange={(e) => { setPrice(e.target.value); setPriceTouched(true); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }} className={`${igInput} tabular text-right`} />
        </InlineField>

        {typeId && useLength && ratio > 0 && (
          <InlineField id="se-m2" label="Giá/m²" labelClass={LABEL}>
            <input id="se-m2" type="number" min={0} step="any" readOnly={!canEditPrice} value={num(price) ? pricePerM2(num(price), ratio) : ""} onChange={(e) => { setPrice(e.target.value === "" ? "" : String(pricePerMd(Number(e.target.value), ratio))); setPriceTouched(true); }} className={`${igInput} tabular text-right`} />
          </InlineField>
        )}
        {typeId && useLength && !ratioKnown && (
          <InlineField id="se-ratio" label="Tỷ lệ m²/md" labelClass={LABEL}>
            <input id="se-ratio" inputMode="decimal" value={ratioInput} onChange={(e) => setRatioInput(e.target.value)} className={`${igInput} tabular text-right`} />
          </InlineField>
        )}
        {typeId && currentType && !currentType.hasBom && <p className="self-center text-xs text-fg-muted md:col-span-2">Chưa có định mức: bán như hàng thường (kho trừ chính sản phẩm).</p>}
        {useLength && ratio > 0 && num(price) > 0 && <p className="self-center text-xs text-fg-muted xl:col-span-2">Dài*số tấm, nối bằng +; mỗi số hạng thành một dòng. Tỷ lệ {String(ratio).replace(".", ",")} m²/md. Giá/m² và giá/md liên động qua tỷ lệ.</p>}

        <InlineField id="se-note" label="Ghi chú" labelClass={LABEL} className="md:col-span-2 xl:col-span-3">
          <input id="se-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className={igInput} />
        </InlineField>
      </>)}

      {error && <p role="alert" className="text-sm text-danger md:col-span-2 xl:col-span-3">{error}</p>}
      <div className="flex justify-end md:col-span-2 xl:col-span-3">
        <button type="button" disabled={disabled || !product} onClick={() => void submit()} className="inline-flex h-11 min-w-40 items-center justify-center gap-1 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-40 md:h-10"><Plus size={16} aria-hidden /> Thêm vào đơn</button>
      </div>
    </div>
  );
}
