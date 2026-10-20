"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Combobox, inputClass, NumberInput, type ComboOption } from "@/components/ui";
import type { TypeOption } from "@/components/sales/QuickDimensionEntry";
import { apiFetch } from "@/lib/api-fetch";
import { parseLengthExpr, pricePerM2, pricePerMd, termNote, termQty } from "@/lib/length-expr";
import type { ProductOption } from "@/server/products/queries";
import type { ReturnPricingDTO } from "@/server/returns/pricing";
import type { ReturnByProductInput } from "@/server/returns/schemas";

type Row = ReturnByProductInput["lines"][number];

/**
 * Nhập nhanh hàng trả theo kích thước (tôn trả theo tấm): sản phẩm → kiểu gia công (lấy tỷ lệ m²/md) → giá/m² → `7.1*7+6.8*1`.
 * Mỗi số hạng thành một dòng, SL tính theo md (đơn vị gốc) nên kho/công nợ không đổi; kích thước ghi vào ghi chú dòng
 * (cùng mẫu dòng bán, `termNote`).
 */
export function ReturnDimensionEntry({ kind, partnerId, loadProducts, onAdd }: {
  kind: "CUSTOMER" | "SUPPLIER"; partnerId: number | undefined; loadProducts: (q: string) => Promise<ProductOption[]>;
  onAdd: (product: ProductOption, rows: Row[]) => void;
}) {
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [ratioInput, setRatioInput] = useState("1"); // kiểu chưa khai tỷ lệ ⇒ mặc định 1, ghi cả vào ghi chú dòng
  const [priceM2, setPriceM2] = useState("");
  const [touched, setTouched] = useState(false);
  const [expr, setExpr] = useState("");
  const [error, setError] = useState("");
  const [pricing, setPricing] = useState<ReturnPricingDTO | null>(null);

  const pickProduct = (o: ComboOption | null) => {
    const p = o as ProductOption | null;
    setProduct(p); setTypes([]); setTypeId(null); setPricing(null); setPriceM2(""); setTouched(false); setError("");
    if (!p) return;
    apiFetch<TypeOption[]>(`/api/orders/options/processing-types?productId=${p.value}`).then(setTypes).catch(() => setTypes([]));
  };
  const currentType = typeId ? types.find((t) => Number(t.value) === typeId) ?? null : null;
  const ratioKnown = !!currentType?.ratio;
  const ratio = currentType?.ratio ?? (Number(ratioInput.replace(",", ".")) || 0);

  useEffect(() => {
    if (!product || !partnerId) { setPricing(null); return; }
    let live = true;
    apiFetch<ReturnPricingDTO | null>(`/api/returns/pricing?kind=${kind}&partnerId=${partnerId}&productId=${product.value}`)
      .then((d) => { if (live) setPricing(d); }).catch(() => { if (live) setPricing(null); });
    return () => { live = false; };
  }, [product?.value, partnerId, kind]);
  // Gợi ý giá/m² từ giá gần nhất (theo md) chia tỷ lệ, chưa gõ tay thì điền
  const suggestedMd = pricing?.units.find((u) => u.unit === pricing.baseUnit)?.suggestedPrice;
  useEffect(() => {
    if (suggestedMd != null && ratio > 0 && !touched) setPriceM2(String(pricePerM2(Number(suggestedMd), ratio)));
  }, [suggestedMd, ratio]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    if (!partnerId) { setError(kind === "SUPPLIER" ? "Chọn nhà cung cấp trước." : "Chọn khách hàng trước."); return; }
    if (!product || !typeId) { setError("Chọn sản phẩm và kiểu gia công."); return; }
    const parsed = parseLengthExpr(expr);
    if ("error" in parsed) { setError(parsed.error); return; }
    if (!(ratio > 0)) { setError("Nhập tỷ lệ m²/md."); return; }
    const m2 = Number(priceM2.replace(",", "."));
    if (!(m2 >= 0) || priceM2.trim() === "") { setError("Nhập giá/m²."); return; }
    onAdd(product, parsed.terms.map((t) => ({ productId: product.value, unit: product.baseUnit, qty: termQty(t), unitPrice: pricePerMd(m2, ratio), note: termNote(t, ratio) })));
    setExpr(""); setError("");
  };
  const lab = "mb-1 block text-xs font-medium text-fg-secondary";
  return (
    <div className="rounded-sm border border-dashed border-border bg-hover/40 p-3">
      <p className="mb-2 text-sm font-semibold">Nhập nhanh theo kích thước</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Combobox label="Sản phẩm" value={product} loadOptions={loadProducts} placeholder="Tìm sản phẩm (mã, tên…)" onChange={pickProduct} />
        <div>
          <label htmlFor="rd-type" className={lab}>Kiểu gia công</label>
          <select id="rd-type" value={typeId ?? ""} onChange={(e) => { setTypeId(e.target.value ? Number(e.target.value) : null); setTouched(false); setError(""); }} className={inputClass()}>
            <option value="">{product ? (types.length ? "— Chọn kiểu gia công —" : "Sản phẩm chưa gắn kiểu gia công") : "Chọn sản phẩm trước"}</option>
            {types.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {typeId && !ratioKnown && (
          <div>
            <label htmlFor="rd-ratio" className={lab}>Tỷ lệ m²/md</label>
            <input id="rd-ratio" inputMode="decimal" value={ratioInput} onChange={(e) => setRatioInput(e.target.value)} className={`${inputClass()} tabular text-right`} />
          </div>
        )}
        {typeId && (<>
          <div>
            <label htmlFor="rd-price" className={lab}>{kind === "SUPPLIER" ? "Giá thỏa thuận/m²" : "Giá trừ công nợ/m²"}</label>
            <NumberInput id="rd-price" maxFrac={2} value={priceM2} onValueChange={(v) => { setPriceM2(v); setTouched(true); }} className={`${inputClass()} tabular text-right`} />
          </div>
          <div className="xl:col-span-2">
            <label htmlFor="rd-len" className={lab}>Chiều dài (dài*số tấm, nối bằng +)</label>
            <input id="rd-len" value={expr} onChange={(e) => { setExpr(e.target.value); setError(""); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }} placeholder="7.1*7+6.8*1" autoComplete="off" className={inputClass()} />
          </div>
        </>)}
      </div>
      {typeId && ratio > 0 && <p className="mt-2 text-xs text-fg-muted">Mỗi số hạng thành một dòng, SL tính theo {product?.baseUnit}. Tỷ lệ {String(ratio).replace(".", ",")} m²/md; giá/md = giá/m² × tỷ lệ.</p>}
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      <div className="mt-3 flex justify-end">
        <button type="button" disabled={!typeId} onClick={submit} className="inline-flex h-11 items-center gap-1 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-40 md:h-10"><Plus size={16} aria-hidden /> Thêm vào phiếu</button>
      </div>
    </div>
  );
}
