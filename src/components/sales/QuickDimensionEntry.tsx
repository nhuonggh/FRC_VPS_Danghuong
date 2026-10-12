"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Combobox, inputClass, type ComboOption, NumberInput } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatQty } from "@/lib/format";
import { parseLengthExpr, pricePerM2, pricePerMd, termNote, termQty } from "@/lib/length-expr";
import type { ProductOption } from "@/server/products/queries";
import type { SalePricingDTO } from "@/server/sales/pricing";
import type { SaleOrderInput } from "@/server/sales/schemas";

/** Kiểu gia công của sản phẩm kèm tỷ lệ m²/md (null = chưa khai báo). */
export type TypeOption = ComboOption & { ratio?: number | null; hasBom?: boolean; priceBasis?: "LENGTH" | "AREA" | "UNIT"; unit?: string | null };

/**
 * Nhập nhanh bán tôn theo kích thước (giống màn "Thêm vào đơn" của hệ thống cũ): chọn SP → kiểu gia công → giá/m² → chiều dài
 * `7.1*7+6.8*1` → "Thêm vào đơn" sinh mỗi số hạng một dòng. SL dòng tính theo md (đơn vị gốc) nên kho/BOM/FIFO không đổi.
 */
export function QuickDimensionEntry({ loadProducts, pricingPartnerId, canEditPrice, disabled, onAdd }: {
  loadProducts: (q: string) => Promise<ProductOption[]>; pricingPartnerId: number | null | undefined; canEditPrice: boolean; disabled: boolean;
  onAdd: (product: ProductOption, rows: SaleOrderInput["lines"]) => void;
}) {
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [ratioInput, setRatioInput] = useState("1"); // chưa có tỷ lệ ⇒ mặc định 1, người bán sửa rồi lưu cho lần sau
  const [priceM2, setPriceM2] = useState("");
  const [expr, setExpr] = useState("");
  const [error, setError] = useState("");
  const [dto, setDto] = useState<SalePricingDTO | null>(null);

  const pickProduct = (o: ComboOption | null) => {
    const p = o as ProductOption | null;
    setProduct(p); setTypes([]); setTypeId(null); setDto(null); setPriceM2(""); setError("");
    if (!p) return;
    apiFetch<TypeOption[]>(`/api/orders/options/processing-types?productId=${p.value}`).then(setTypes).catch(() => setTypes([]));
  };
  const currentType = typeId ? types.find((t) => Number(t.value) === typeId) ?? null : null;
  const ratioKnown = !!currentType?.ratio;
  const ratio = currentType?.ratio ?? (Number(ratioInput.replace(",", ".")) || 0);

  // Chọn kiểu gia công → tồn + giá gần nhất của đúng kiểu gia công
  useEffect(() => {
    if (!product || !typeId || !pricingPartnerId) { setDto(null); return; }
    let live = true;
    apiFetch<SalePricingDTO | null>(`/api/orders/pricing?partnerId=${pricingPartnerId}&productId=${product.value}&processingTypeId=${typeId}`).then((d) => { if (live) setDto(d); }).catch(() => { if (live) setDto(null); });
    return () => { live = false; };
  }, [product?.value, typeId, pricingPartnerId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Gợi ý giá/m² từ giá gần nhất (không có quyền sửa giá thì luôn ép theo giá gần nhất)
  useEffect(() => {
    if (dto?.lastSalePrice != null && ratio > 0 && (!priceM2 || !canEditPrice)) setPriceM2(String(pricePerM2(Number(dto.lastSalePrice), ratio)));
  }, [dto, ratio]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!product || !typeId) { setError("Chọn sản phẩm và kiểu gia công."); return; }
    const parsed = parseLengthExpr(expr);
    if ("error" in parsed) { setError(parsed.error); return; }
    if (!(ratio > 0)) { setError("Nhập tỷ lệ m²/md."); return; }
    const m2 = Number(priceM2);
    if (!(m2 > 0)) { setError(canEditPrice ? "Nhập giá/m²." : "Chưa có giá bán tham chiếu — nhờ người có quyền sửa giá nhập lần đầu."); return; }
    if (!ratioKnown) {
      try {
        const r = await apiFetch<{ ratio: string }>("/api/orders/processing-ratio", { method: "POST", json: { productId: product.value, processingTypeId: typeId, ratio } });
        setTypes((all) => all.map((t) => (Number(t.value) === typeId ? { ...t, ratio: Number(r.ratio) } : t)));
      } catch (e) { setError(e instanceof Error ? e.message : "Không lưu được tỷ lệ."); return; }
    }
    const rows = parsed.terms.map((t) => ({
      productId: product.value, unit: product.baseUnit, qty: termQty(t), salePrice: pricePerMd(m2, ratio), discountNow: 0, discountAccum: 0, processingTypeId: typeId, note: termNote(t, ratio),
    }));
    onAdd(product, rows as SaleOrderInput["lines"]);
    setExpr(""); setError("");
  };
  const lab = "mb-1 block text-xs font-medium text-fg-secondary";
  return (
    <div className="mb-3 rounded-sm border border-dashed border-border bg-hover/40 p-3">
      <p className="mb-2 text-sm font-semibold">Nhập nhanh tôn theo kích thước</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Combobox label="Sản phẩm" value={product} loadOptions={loadProducts} placeholder="Tìm sản phẩm (mã, tên…)" onChange={pickProduct} disabled={disabled} />
        <div>
          <label htmlFor="qd-type" className={lab}>Kiểu gia công</label>
          <select id="qd-type" value={typeId ?? ""} onChange={(e) => { setTypeId(e.target.value ? Number(e.target.value) : null); setPriceM2(""); setError(""); }} className={inputClass()}>
            <option value="">{product ? "— Chọn kiểu gia công —" : "Chọn sản phẩm trước"}</option>
            {types.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {typeId && currentType && !currentType.hasBom && <p className="self-end text-xs text-fg-muted md:col-span-2">Chưa có định mức: bán như hàng thường (kho trừ chính sản phẩm).</p>}
        {typeId && !ratioKnown && (
          <div>
            <label htmlFor="qd-ratio" className={lab}>Tỷ lệ m²/md (lưu cho lần sau)</label>
            <input id="qd-ratio" inputMode="decimal" value={ratioInput} onChange={(e) => setRatioInput(e.target.value)} className={`${inputClass()} tabular text-right`} />
          </div>
        )}
        {typeId && (<>
          <div>
            <label htmlFor="qd-price" className={lab}>Đơn giá theo m²</label>
            <NumberInput maxFrac={2} id="qd-price" readOnly={!canEditPrice} value={priceM2} onValueChange={setPriceM2} className={`${inputClass()} tabular text-right ${canEditPrice ? "" : "bg-hover"}`} />
          </div>
          <div className="xl:col-span-2">
            <label htmlFor="qd-len" className={lab}>Chiều dài (dài*số tấm, nối bằng +)</label>
            <input id="qd-len" value={expr} onChange={(e) => { setExpr(e.target.value); setError(""); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} placeholder="7.1*7+6.8*1" className={inputClass()} />
          </div>
        </>)}
      </div>
      {product && typeId && dto && (
        <p className="mt-2 text-xs text-fg-secondary">
          {dto.onHand !== undefined && <>Còn tồn: {formatQty(dto.onHand)} {dto.baseUnit}</>}
          {dto.lastSalePrice != null && <>{dto.onHand !== undefined && " | "}Giá bán gần nhất{dto.lastSalePriceForPartner ? " (khách này)" : " (khách khác)"}: {formatCurrency(dto.lastSalePrice)}/{dto.baseUnit}{ratio > 0 && <> ≈ {formatCurrency(pricePerM2(Number(dto.lastSalePrice), ratio))}/m²</>}</>}
          {dto.lastPurchasePrice != null && <> | Giá nhập gần nhất: {formatCurrency(dto.lastPurchasePrice)}/{dto.baseUnit}</>}
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-3 flex justify-end">
        <button type="button" disabled={disabled || !typeId} onClick={submit} className="inline-flex h-11 items-center gap-1 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-40 md:h-10"><Plus size={16} aria-hidden /> Thêm vào đơn</button>
      </div>
    </div>
  );
}
