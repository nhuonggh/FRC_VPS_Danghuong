"use client";

import { CostReferenceInfo, referencePerBase } from "./CostReferenceInfo";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Combobox, type ComboOption, NumberInput } from "@/components/ui";
import { igCombo, igInput, InlineField } from "@/components/sales/InlineField";
import type { TypeOption } from "@/components/sales/QuickDimensionEntry";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatQty } from "@/lib/format";
import { sameUnit } from "@/lib/price-basis";
import { priceFromWeight, priceToWeight } from "@/lib/weight-price";
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
export function SaleLineEntry({ date, loadProducts, pricingPartnerId, canEditPrice, disabled, warehouses, warehouseId, onWarehouse, onAdd }: {
  date?: string; loadProducts: (q: string) => Promise<ProductOption[]>; pricingPartnerId: number | null | undefined; canEditPrice: boolean; disabled: boolean;
  warehouses: ComboOption[]; warehouseId: number | null; onWarehouse: (id: number | null) => void;
  onAdd: (product: ProductOption, rows: SaleOrderInput["lines"]) => void;
}) {
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [ratioInput, setRatioInput] = useState("1"); // chưa có tỷ lệ ⇒ mặc định 1, lưu cho lần sau
  const [unit, setUnit] = useState("");
  const [len, setLen] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [dto, setDto] = useState<SalePricingDTO | null>(null);
  const [pickKey, setPickKey] = useState(0);
  // Bán theo giá thị trường (nhập đơn giá/md, giá theo tỷ trọng tự tính) hoặc theo tỷ trọng (nhập giá/kg, đơn giá tự tính).
  const [priceMode, setPriceMode] = useState<"market" | "weight">(() => { try { return localStorage.getItem("sale-price-mode") === "weight" ? "weight" : "market"; } catch { return "market"; } });
  const [weightUnit, setWeightUnit] = useState("");
  const [weightStr, setWeightStr] = useState<string | null>(null); // đang gõ ở ô giá theo tỷ trọng; null = hiển thị giá trị tính từ đơn giá
  const [m2Str, setM2Str] = useState<string | null>(null); // đang gõ ở ô Giá/m² (ô gốc, giữ nguyên số đã gõ); null = giá/md là ô gốc, giá/m² tính ra
  const chooseMode = (m: "market" | "weight") => { setPriceMode(m); setWeightStr(null); setM2Str(null); try { localStorage.setItem("sale-price-mode", m); } catch { /* không lưu được thì thôi */ } };

  const reset = () => { setProduct(null); setTypes([]); setTypeId(null); setUnit(""); setLen(""); setQty(""); setPrice(""); setPriceTouched(false); setNote(""); setError(""); setDto(null); setPickKey((k) => k + 1); setWeightUnit(""); setWeightStr(null); setM2Str(null); };
  const pickProduct = (o: ComboOption | null) => {
    const p = o as ProductOption | null;
    if (!p) { reset(); return; }
    setProduct(p); setTypes([]); setTypeId(null); setUnit(p.baseUnit); setLen(""); setQty(""); setPrice(""); setPriceTouched(false); setNote(""); setError(""); setDto(null); setWeightUnit(p.units?.[0]?.unit ?? ""); setWeightStr(null); setM2Str(null);
    apiFetch<TypeOption[]>(`/api/orders/options/processing-types?productId=${p.value}`).then(setTypes).catch(() => setTypes([]));
  };

  const currentType = typeId ? types.find((t) => Number(t.value) === typeId) ?? null : null;
  const ratioKnown = !!currentType?.ratio;
  const ratio = currentType?.ratio ?? (Number(ratioInput.replace(",", ".")) || 0);
  // Đổi tỷ lệ/kiểu gia công: ô gốc (giá/m² đã gõ) đứng yên, đơn giá/md tính lại
  useEffect(() => { if (m2Str !== null && m2Str !== "" && ratio > 0) setPrice(String(pricePerMd(Number(m2Str), ratio))); }, [ratio]); // eslint-disable-line react-hooks/exhaustive-deps
  const useLength = len.trim() !== "";
  // Tỷ trọng chỉ áp khi đơn giá đang tính theo đơn vị gốc (dòng chiều dài, hoặc chọn đơn vị gốc) và sản phẩm có đơn vị quy đổi.
  const wUnit = product?.units?.find((u) => u.unit === weightUnit) ?? product?.units?.[0] ?? null;
  const weightFactor = wUnit ? Number(wUnit.factor) : 0;
  const weightApplies = !!product && weightFactor > 0 && (useLength || unit === product.baseUnit);
  const weightMode = weightApplies && priceMode === "weight";
  // Kiểu gia công tính giá theo m²: chỉ nhập giá/m² (ô gốc), giá/md tính ra; đơn giá lưu vẫn là giá/md của đơn vị gốc
  const isArea = currentType?.priceBasis === "AREA";
  const isUnitBasis = currentType?.priceBasis === "UNIT"; // bán theo ĐVT riêng của kiểu: không có chiều dài / m²
  const areaMode = isArea && ratio > 0 && !weightMode && (useLength || !product || unit === product.baseUnit);
  const perM2 = (v: number | string) => (areaMode ? `${formatCurrency(pricePerM2(Number(v), ratio))}/m²` : null);
  // Đơn giá thấp hơn giá nhập gần nhất (cùng đơn vị gốc) ⇒ báo đỏ để kế toán xem lại
  const lineFactor = useLength || !product ? 1 : Number(product.units?.find((u) => u.unit === unit)?.factor ?? 1) || 1;
  const referenceCost = referencePerBase(dto);
  const belowCost = referenceCost != null && num(price) > 0 && num(price) * lineFactor < Number(referenceCost) - 0.005;
  const redInput = belowCost ? "!border-danger !text-danger" : "";
  const costNote = belowCost && referenceCost != null ? <p role="alert" className="text-sm font-medium text-danger md:col-span-2 xl:col-span-3">Đơn giá thấp hơn giá vốn tham khảo ({perM2(referenceCost) ?? `${formatCurrency(Number(referenceCost) / lineFactor)}/${useLength ? product?.baseUnit : unit}`}) — kiểm tra lại giá bán.</p> : null;

  // Tồn + giá gần nhất (theo đúng kiểu gia công đang chọn); đổi khách → tải lại
  useEffect(() => {
    if (!product || !pricingPartnerId) { setDto(null); return; }
    let live = true;
    setDto(null);
    apiFetch<SalePricingDTO | null>(`/api/orders/pricing?partnerId=${pricingPartnerId}&productId=${product.value}${date ? `&date=${date}` : ""}${typeId ? `&processingTypeId=${typeId}` : ""}`)
      .then((d) => { if (live) setDto(d); }).catch(() => { if (live) setDto(null); });
    return () => { live = false; };
  }, [product?.value, typeId, pricingPartnerId, date]); // eslint-disable-line react-hooks/exhaustive-deps
  // Giá gợi ý: chưa sửa tay thì điền giá gần nhất của đơn vị đang chọn (dòng chiều dài luôn tính theo đơn vị gốc); không có quyền sửa giá thì luôn ép theo gợi ý
  useEffect(() => {
    const u = useLength ? product?.baseUnit : unit;
    const s = dto?.units.find((x) => x.unit === u)?.suggestedPrice;
    if (s != null && (!priceTouched || !canEditPrice)) { setPrice(String(Number(s))); setWeightStr(null); setM2Str(null); }
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
    // Thêm xong: giữ khung nhập ở trên, đưa con trỏ về ô chọn sản phẩm để nhập tiếp (không để trang nhảy xuống chi tiết)
    requestAnimationFrame(() => {
      const box = document.getElementById("se-product-wrap");
      box?.querySelector<HTMLInputElement>('[role="combobox"]')?.focus({ preventScroll: true });
      box?.scrollIntoView?.({ block: "center" });
    });
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
        <div id="se-product-wrap" className={igCombo}><Combobox key={pickKey} hideLabel label="Tên sản phẩm" value={product} loadOptions={loadProducts} placeholder="Tìm sản phẩm (mã, tên…)" onChange={pickProduct} disabled={disabled} /></div>
      </InlineField>
      {product ? (
        <p className={info} role="status">
          {dto?.onHand !== undefined ? <>Còn tồn <b className="tabular">{formatQty(dto.onHand)}</b> {dto.baseUnit}</> : <span className="text-fg-muted">{pricingPartnerId ? "Đang tải tồn…" : "Chọn khách hàng để xem tồn, giá gợi ý"}</span>}
        </p>
      ) : <span className="hidden xl:block" />}

      {product && (<>
        <CostReferenceInfo dto={dto} unit={areaMode ? "m²" : (useLength ? product.baseUnit : unit)} divisor={areaMode ? ratio : lineFactor} />
        <InlineField id="se-type" label="Kiểu gia công" labelClass={LABEL}>
          <select id="se-type" value={typeId ?? ""} onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : null; setTypeId(id); setPriceTouched(false); setError("");
            // Kiểu bán theo ĐVT riêng (kg, bình, cây…): đơn vị dòng tự chọn đúng ĐVT đó
            const t = id ? types.find((x) => Number(x.value) === id) : null;
            if (t?.priceBasis === "UNIT" && t.unit) { const u = product?.units?.find((x) => sameUnit(x.unit, t.unit)); if (u) { setUnit(u.unit); setLen(""); } else setError(`Sản phẩm chưa khai đơn vị "${t.unit}" (Sản phẩm → Đơn vị & quy đổi).`); }
          }} className={`${igInput} cursor-pointer`}>
            <option value="">Không</option>
            {types.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </InlineField>
        <p className={`${info} justify-between`}>
          <span>Giá bán gần nhất{dto?.lastSalePrice != null ? (dto.lastSalePriceForPartner ? " (khách này)" : dto.lastSalePriceSource === "default" ? " (giá mặc định)" : " (cùng nhóm khách)") : ""}</span>
          <b className="tabular">{dto?.lastSalePrice != null ? (perM2(dto.lastSalePrice) ?? `${formatCurrency(dto.lastSalePrice)}/${dto.baseUnit}`) : "—"}</b>
        </p>

        {!isUnitBasis && <InlineField id="se-len" label="Chiều dài" labelClass={LABEL}>
          <input id="se-len" value={len} onChange={(e) => { setLen(e.target.value); setError(""); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }} placeholder="7.1*7+6.8*1" autoComplete="off" className={igInput} />
        </InlineField>}
        <InlineField id="se-qty" label="Số lượng" labelClass={LABEL}>
          <NumberInput id="se-qty" maxFrac={3} value={useLength ? "" : qty} disabled={useLength} placeholder={useLength ? "Tính từ chiều dài" : ""} onValueChange={setQty} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }} className={`${igInput} tabular text-right`} />
          <select aria-label="Đơn vị tính" value={useLength ? product.baseUnit : unit} disabled={useLength} onChange={(e) => { setUnit(e.target.value); setPriceTouched(false); }} className="h-11 shrink-0 cursor-pointer border-l border-border bg-hover px-2 text-sm outline-none disabled:opacity-60 md:h-9">
            {(product.units ?? []).map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
          </select>
        </InlineField>
        {areaMode && (
          <InlineField id="se-m2" label="Đơn giá/m²" labelClass={LABEL} className="md:col-start-2 xl:col-start-2">
            <NumberInput maxFrac={2} id="se-m2" readOnly={!canEditPrice} value={m2Str ?? (num(price) ? pricePerM2(num(price), ratio) : "")} onValueChange={(val) => { const v = val; setPrice(v === "" ? "" : String(pricePerMd(Number(v), ratio))); setPriceTouched(true); setWeightStr(null); setM2Str(v); }} className={`${igInput} tabular text-right ${redInput}`} />
          </InlineField>
        )}
        {!areaMode && <InlineField id="se-price" label={useLength ? "Đơn giá/md" : "Đơn giá"} labelClass={LABEL} hint={m2Str !== null ? "tính từ giá/m² đã nhập" : undefined}>
          <NumberInput maxFrac={2} id="se-price" readOnly={!canEditPrice || weightMode} value={price} onValueChange={(val) => { setPrice(val); setPriceTouched(true); setWeightStr(null); setM2Str(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }} className={`${igInput} tabular text-right ${redInput}`} />
        </InlineField>}
        {weightApplies && wUnit && (<>
          <InlineField id="se-wprice" label={`Giá/${wUnit.unit} (tỷ trọng)`} labelClass={LABEL}>
            <NumberInput maxFrac={2} id="se-wprice" readOnly={!canEditPrice || !weightMode} value={weightStr ?? (num(price) ? priceToWeight(num(price), weightFactor) : "")} onValueChange={(val) => { setWeightStr(val); setPrice(val === "" ? "" : String(priceFromWeight(Number(val), weightFactor))); setPriceTouched(true); setM2Str(null); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }} className={`${igInput} tabular text-right ${weightMode ? "" : "opacity-70"} ${redInput}`} />
          </InlineField>
          <div className="flex flex-wrap items-center gap-2 text-sm md:col-span-2 xl:col-span-3">
            <div role="group" aria-label="Cách tính giá" className="inline-flex overflow-hidden rounded-sm border border-border">
              {([["market", "Giá thị trường"], ["weight", "Theo tỷ trọng"]] as const).map(([m, label]) => <button key={m} type="button" aria-pressed={priceMode === m} disabled={!canEditPrice} onClick={() => chooseMode(m)} className={`h-9 px-3 font-medium disabled:opacity-50 ${priceMode === m ? "bg-accent text-fg-on-accent" : "bg-canvas hover:bg-hover"}`}>{label}</button>)}
            </div>
            {(product?.units?.length ?? 0) > 1 && <select aria-label="Đơn vị tỷ trọng" value={wUnit.unit} onChange={(e) => { setWeightUnit(e.target.value); setWeightStr(null); setM2Str(null); }} className="h-9 cursor-pointer rounded-sm border border-border bg-canvas px-2">{product!.units!.map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}</select>}
            <span className="text-xs text-fg-muted">Tỷ trọng {formatQty(wUnit.factor)} {wUnit.unit}/{product!.baseUnit} — {weightMode ? `nhập giá/${wUnit.unit}, đơn giá tự tính` : `nhập đơn giá, giá/${wUnit.unit} tự tính`}.</span>
          </div>
        </>)}

        {typeId && (useLength || isArea) && !ratioKnown && (
          <InlineField id="se-ratio" label="Tỷ lệ m²/md" labelClass={LABEL}>
            <input id="se-ratio" inputMode="decimal" value={ratioInput} onChange={(e) => setRatioInput(e.target.value)} className={`${igInput} tabular text-right`} />
          </InlineField>
        )}
        {typeId && currentType && !currentType.hasBom && <p className="self-center text-xs text-fg-muted md:col-span-2">Chưa có định mức: bán như hàng thường (kho trừ chính sản phẩm).</p>}
        {useLength && ratio > 0 && num(price) > 0 && <p className="self-center text-xs text-fg-muted xl:col-span-2">Dài*số tấm, nối bằng +; mỗi số hạng thành một dòng. Tỷ lệ {String(ratio).replace(".", ",")} m²/md. Giá/m² và giá/md liên động qua tỷ lệ.</p>}

        {costNote}
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
