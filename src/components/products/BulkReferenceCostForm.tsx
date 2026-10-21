"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";
import { Combobox, FormCard, FormGrid, InlineField, NewPage, NumberInput, ProductMultiPicker, igCombo, igInput, type ComboOption } from "@/components/ui";
import { filterComboOptions } from "@/components/ui/Combobox";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "@/lib/toast";

type Picked = ComboOption & { value: number };
/** Một kiểu gia công → cấu hình giá vốn tham khảo (tôn + vật liệu phụ + phí) áp cho nhiều sản phẩm trong một lần lưu. */
export function BulkReferenceCostForm({ today, types }: { today: string; types: ComboOption[] }) {
  const router = useRouter();
  const [type, setType] = useState<ComboOption | null>(null);
  const [products, setProducts] = useState<Picked[]>([]);
  const [allLinked, setAllLinked] = useState(false);
  const [date, setDate] = useState(today);
  const [ton, setTon] = useState<ComboOption | null>(null);
  const [fixed, setFixed] = useState(true);
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const [auxFixed, setAuxFixed] = useState(false);
  const [auxPrice, setAuxPrice] = useState("");
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");
  const count = allLinked ? "tất cả sản phẩm của kiểu" : `${products.length} sản phẩm`;
  async function submit() {
    if (!type || !ton || !date || (!allLinked && products.length === 0) || (fixed && price === "") || (auxFixed && auxPrice === "")) throw new Error("Chọn kiểu gia công, sản phẩm, mã tôn, ngày hiệu lực và nhập đủ giá bắt buộc.");
    const r = await apiFetch<{ created: number; skipped: string[] }>("/api/reference-cost-plans/bulk", { method: "POST", json: {
      processingTypeId: Number(type.value), validFrom: date, tonProductId: Number(ton.value),
      fixedPricePerM2: fixed ? Number(price) : null, tonQtyPerMeter: fixed ? 1 : Number(qty),
      feePerMeter: fee === "" ? null : Number(fee), auxFixedPerMeter: auxFixed ? Number(auxPrice) : null, note,
      ...(allLinked ? { allLinked: true } : { productIds: products.map(p => p.value) }),
    } });
    toast.success(`Đã lưu dự toán cho ${r.created} sản phẩm.${r.skipped.length ? ` Bỏ qua ${r.skipped.length} sản phẩm chưa gắn kiểu hoặc không tính theo mét dài.` : ""}`);
    router.push("/inventory/processing-types");
  }
  return <NewPage wide bare backHref="/inventory/processing-types" backLabel="Quay lại kiểu gia công" title="Giá vốn gia công cho nhiều sản phẩm" submitLabel={`Lưu cho ${count}`} isDirty={() => products.length > 0 || ton !== null} onSubmit={submit}>
    <FormCard title="Kiểu gia công và sản phẩm">
      <p className="mb-3 text-sm text-fg-secondary">Chọn một kiểu gia công, các sản phẩm (đã gắn kiểu này, đơn vị mét dài) rồi nhập một cấu hình dùng chung. Mỗi sản phẩm nhận một phiên bản riêng; cấu hình mới không sửa dự toán đã lưu trên đơn cũ.</p>
      <FormGrid cols={2}>
        <InlineField id="bulk-type" label="Kiểu gia công" required><div className={igCombo}><Combobox hideLabel label="Kiểu gia công" value={type} onChange={t => { setType(t); setProducts([]); setAllLinked(false); }} loadOptions={async q => filterComboOptions(types, q)} /></div></InlineField>
        <InlineField id="bulk-date" label="Hiệu lực từ" required><input id="bulk-date" type="date" min={today} value={date} onChange={e => setDate(e.target.value)} className={igInput} /></InlineField>
      </FormGrid>
      {type && <div className="mt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <ProductMultiPicker<Picked> disabled={allLinked} buttonLabel="Chọn sản phẩm" existingIds={products.map(p => p.value)}
            load={q => apiFetch<Picked[]>(`/api/reference-cost-plans/bulk?processingTypeId=${type.value}&q=${encodeURIComponent(q)}`)}
            onPicked={list => setProducts(cur => [...cur, ...list.filter(p => !cur.some(c => c.value === p.value))])} />
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={allLinked} onChange={e => setAllLinked(e.target.checked)} />Áp cho tất cả sản phẩm đã gắn kiểu này</label>
        </div>
        {!allLinked && (products.length === 0 ? <p className="text-sm text-fg-muted">Chưa chọn sản phẩm nào.</p> : <ul className="flex flex-wrap gap-2" aria-label="Sản phẩm đã chọn">{products.map(p => <li key={p.value} className="flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-sm"><span className="max-w-64 truncate">{p.label}</span>
          <button type="button" aria-label={`Bỏ ${p.label}`} className="text-fg-muted hover:text-danger" onClick={() => setProducts(cur => cur.filter(c => c.value !== p.value))}><X size={14} /></button></li>)}</ul>)}
      </div>}
    </FormCard>
    <FormCard title="Cấu hình giá vốn dùng chung">
      <FormGrid cols={2}>
        <InlineField id="bulk-ton" label="Mã tôn đầu vào" required><div className={igCombo}><Combobox hideLabel label="Mã tôn đầu vào" value={ton} onChange={setTon} loadOptions={q => apiFetch<ComboOption[]>(`/api/reference-cost-materials?q=${encodeURIComponent(q)}`)} /></div></InlineField>
        <InlineField id="bulk-source" label="Nguồn giá tôn"><select id="bulk-source" value={fixed ? "FIXED" : "PURCHASE"} onChange={e => setFixed(e.target.value === "FIXED")} className={igInput}><option value="FIXED">Giá kế hoạch cố định theo khổ gia công</option><option value="PURCHASE">Giá nhập nguyên liệu gần nhất tại ngày đơn</option></select></InlineField>
        {fixed ? <InlineField id="bulk-price" label="Giá tôn (đ/m²)" required><NumberInput id="bulk-price" value={price} onValueChange={setPrice} maxFrac={4} className={`${igInput} tabular text-right`} /></InlineField>
          : <InlineField id="bulk-qty" label="Lượng tôn / m dài" required hint="Theo đơn vị gốc mã tôn. Nếu BOM đã có mã tôn, dùng lượng theo BOM."><NumberInput id="bulk-qty" value={qty} onValueChange={setQty} maxFrac={6} className={`${igInput} tabular text-right`} /></InlineField>}
        <InlineField id="bulk-aux-source" label="Nguồn vật liệu phụ"><select id="bulk-aux-source" value={auxFixed ? "FIXED" : "PURCHASE"} onChange={e => setAuxFixed(e.target.value === "FIXED")} className={igInput}><option value="PURCHASE">Giá nhập gần nhất theo định mức (BOM)</option><option value="FIXED">Giá cố định (đ/m dài)</option></select></InlineField>
        {auxFixed && <InlineField id="bulk-aux-price" label="Vật liệu phụ (đ/m dài)" required><NumberInput id="bulk-aux-price" value={auxPrice} onValueChange={setAuxPrice} maxFrac={4} className={`${igInput} tabular text-right`} /></InlineField>}
        <InlineField id="bulk-fee" label="Phí gia công (đ/m dài)" hint="Để trống = dùng phí mặc định của kiểu; nhập 0 = không tính phí."><NumberInput id="bulk-fee" value={fee} onValueChange={setFee} maxFrac={4} className={`${igInput} tabular text-right`} /></InlineField>
        <InlineField id="bulk-note" label="Ghi chú"><input id="bulk-note" value={note} maxLength={300} onChange={e => setNote(e.target.value)} className={igInput} /></InlineField>
      </FormGrid>
    </FormCard>
  </NewPage>;
}
