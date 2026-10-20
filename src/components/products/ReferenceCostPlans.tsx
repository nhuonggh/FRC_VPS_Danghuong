"use client";
import { useEffect, useState } from "react";
import { Combobox, FormCard, FormGrid, InlineField, NumberInput, igCombo, igInput, type ComboOption } from "@/components/ui";
import { filterComboOptions } from "@/components/ui/Combobox";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatDate, formatQty } from "@/lib/format";
import { ictYmd } from "@/lib/time";
import { toast } from "@/lib/toast";
import { confirm } from "@/lib/confirm-store";

interface Row {
  id: number; used: boolean; productId: number | null; processingTypeId: number; typeName: string; validFrom: string;
  ton: ComboOption | null; fixedPricePerM2: string | null; tonQtyPerMeter: string; feePerMeter: string | null; note: string | null;
}
export function ReferenceCostPlans({ productId, types, canManage, canDefault }: {
  productId: number; types: ComboOption[]; canManage: boolean; canDefault: boolean;
}) {
  const url = `/api/products/${productId}/reference-cost-plans`;
  const today = ictYmd(new Date());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<ComboOption | null>(null);
  const [scope, setScope] = useState(canManage ? "PRODUCT" : "TYPE");
  const [date, setDate] = useState(today);
  const [ton, setTon] = useState<ComboOption | null>(null);
  const [fixed, setFixed] = useState(true);
  const [price, setPrice] = useState("");
  const [qty, setQty] = useState("1");
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { let active = true; setLoading(true); apiFetch<Row[]>(url).then(r => { if (active) setRows(r); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [url]);
  async function save() {
    if (busy) return;
    setError("");
    if (!type || !date || (scope === "PRODUCT" && (!ton || (fixed && price === ""))) || (scope === "TYPE" && fee === "")) { setError("Chọn kiểu, ngày hiệu lực và nhập đủ giá/phí bắt buộc."); return; }
    setBusy(true);
    try {
      await apiFetch(url, { method: "POST", json: { scope, processingTypeId: Number(type!.value), validFrom: date,
        tonProductId: scope === "PRODUCT" ? Number(ton!.value) : null,
        fixedPricePerM2: scope === "PRODUCT" && fixed ? Number(price) : null,
        tonQtyPerMeter: scope === "TYPE" || fixed ? 1 : Number(qty), feePerMeter: fee === "" ? null : Number(fee), note } });
      setRows(await apiFetch<Row[]>(url)); toast.success("Đã lưu phiên bản dự toán.");
    } catch (e) { setError(e instanceof Error ? e.message : "Không lưu được dự toán."); }
    finally { setBusy(false); }
  }
  const canEdit = (r: Row) => r.productId === null ? canDefault : canManage;
  // Bản đang hiệu lực = bản mới nhất có hiệu lực từ ≤ hôm nay, tính riêng cho từng kiểu gia công và từng loại (riêng sản phẩm / mặc định kiểu).
  const effectiveIds = new Set<number>();
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.processingTypeId}:${r.productId === null ? "T" : "P"}`;
    if (r.validFrom <= today && !seen.has(key)) { seen.add(key); effectiveIds.add(r.id); }
  }
  function applyTemplate(r: Row) {
    setError("");
    setType({ value: r.processingTypeId, label: r.typeName }); setScope(r.productId === null ? "TYPE" : "PRODUCT");
    setDate(today); setTon(r.ton); setFixed(r.fixedPricePerM2 !== null); setPrice(r.fixedPricePerM2 ?? "");
    setQty(r.tonQtyPerMeter); setFee(r.feePerMeter ?? ""); setNote(r.note ?? "");
    document.getElementById("reference-type")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  async function remove(r: Row) {
    if (busy) return;
    if (!await confirm({ title: "Xoá phiên bản dự toán?", description: `${r.typeName} · hiệu lực từ ${formatDate(r.validFrom)}. Không hoàn tác được.`, confirmLabel: "Xoá", danger: true })) return;
    setBusy(true); setError("");
    try {
      await apiFetch(`${url}/${r.id}`, { method: "DELETE" });
      setRows(await apiFetch<Row[]>(url)); toast.success("Đã xoá phiên bản dự toán.");
    } catch (e) { setError(e instanceof Error ? e.message : "Không xoá được phiên bản."); }
    finally { setBusy(false); }
  }
  return <FormCard title="Giá vốn tham khảo theo khổ gia công">
    <p className="mb-3 text-sm text-fg-secondary">Tôn đầu vào + vật liệu phụ theo định mức + phí gia công gộp. Giá tôn cố định tính theo m² khổ thành phẩm; phí tính theo mét dài. Chọn đúng mã tôn để không tính trùng với BOM. Cấu hình mới không sửa dự toán đã lưu trên đơn cũ.</p>
    {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
    {(canManage || canDefault) && <fieldset disabled={busy} className="space-y-3">
      <FormGrid cols={2}>
        <InlineField id="reference-type" label="Kiểu gia công" required><div className={igCombo}><Combobox hideLabel label="Kiểu gia công dự toán" value={type} onChange={setType} loadOptions={async q => filterComboOptions(types, q)} /></div></InlineField>
        <InlineField id="reference-date" label="Hiệu lực từ" required><input id="reference-date" type="date" min={today} value={date} onChange={e => setDate(e.target.value)} className={igInput} /></InlineField>
        <InlineField id="reference-scope" label="Áp dụng">
          <select id="reference-scope" value={scope} className={igInput} onChange={e => setScope(e.target.value)}>
            {canManage && <option value="PRODUCT">Riêng sản phẩm và kiểu gia công</option>}
            {canDefault && <option value="TYPE">Phí mặc định cho kiểu gia công (mọi sản phẩm)</option>}
          </select>
        </InlineField>
        {scope === "PRODUCT" && <>
          <InlineField id="reference-ton" label="Mã tôn đầu vào" required><div className={igCombo}><Combobox hideLabel label="Mã tôn đầu vào" value={ton} onChange={setTon} loadOptions={q => apiFetch<ComboOption[]>(`/api/reference-cost-materials?q=${encodeURIComponent(q)}`)} /></div></InlineField>
          <InlineField id="reference-source" label="Nguồn giá tôn"><select id="reference-source" value={fixed ? "FIXED" : "PURCHASE"} onChange={e => setFixed(e.target.value === "FIXED")} className={igInput}><option value="FIXED">Giá kế hoạch cố định theo khổ gia công</option><option value="PURCHASE">Giá nhập nguyên liệu gần nhất tại ngày đơn</option></select></InlineField>
          {fixed ? <InlineField id="reference-price" label="Giá tôn (đ/m²)" required><NumberInput id="reference-price" value={price} onValueChange={setPrice} maxFrac={4} className={`${igInput} tabular text-right`} /></InlineField>
            : <InlineField id="reference-qty" label="Lượng tôn / m dài" required hint="Theo đơn vị gốc mã tôn. Nếu BOM đã có mã tôn, dùng lượng theo BOM."><NumberInput id="reference-qty" value={qty} onValueChange={setQty} maxFrac={6} className={`${igInput} tabular text-right`} /></InlineField>}
        </>}
        <InlineField id="reference-fee" label="Phí gia công (đ/m dài)" required={scope === "TYPE"} hint={scope === "PRODUCT" ? "Để trống = dùng phí mặc định của kiểu; nhập 0 = không tính phí." : "Phí gộp nhân công và chi phí khác; áp dụng khi sản phẩm chưa khai báo mức riêng."}><NumberInput id="reference-fee" value={fee} onValueChange={setFee} maxFrac={4} className={`${igInput} tabular text-right`} /></InlineField>
        <InlineField id="reference-note" label="Ghi chú"><input id="reference-note" value={note} maxLength={300} onChange={e => setNote(e.target.value)} className={igInput} /></InlineField>
      </FormGrid>
      <div className="flex justify-end"><button type="button" disabled={busy || types.length === 0} onClick={() => void save()} className="h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-50">{busy ? "Đang lưu…" : "Lưu phiên bản dự toán"}</button></div>
    </fieldset>}
    <div className="mt-4 space-y-3" aria-label="Lịch sử cấu hình dự toán">
      {loading ? <p role="status" className="text-sm text-fg-secondary">Đang tải cấu hình…</p> : rows.length === 0 ? <p className="text-sm text-fg-secondary">Chưa có cấu hình. Hiện hệ thống chỉ tham khảo vật liệu theo BOM; chưa tính đủ giá tôn và phí gia công.</p> : rows.map(r => <article key={r.id} className="rounded-sm border border-border p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{r.typeName} · {r.productId === null ? "Phí mặc định kiểu" : "Mức riêng sản phẩm"}</h3>
          {effectiveIds.has(r.id) && <span className="rounded-sm bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">Đang hiệu lực</span>}
          {r.used && <span className="rounded-sm bg-hover px-2 py-0.5 text-xs text-fg-secondary">Đã dùng trên đơn</span>}
          {canEdit(r) && <span className="ml-auto flex gap-2">
            <button type="button" disabled={busy} onClick={() => applyTemplate(r)} className="h-9 rounded-sm border border-border px-3 text-xs font-medium hover:bg-hover disabled:opacity-50">Dùng làm mẫu</button>
            {!r.used && <button type="button" disabled={busy} onClick={() => void remove(r)} className="h-9 rounded-sm border border-border px-3 text-xs font-medium text-danger hover:bg-hover disabled:opacity-50">Xoá</button>}
          </span>}
        </div>
        <dl className="mt-2 grid gap-2 md:grid-cols-2">
          <div><dt className="text-fg-secondary">Hiệu lực từ</dt><dd>{formatDate(r.validFrom)}</dd></div>
          {r.ton && <div><dt className="text-fg-secondary">Tôn đầu vào</dt><dd>{r.ton.label}</dd></div>}
          {r.productId !== null && <div><dt className="text-fg-secondary">Giá tôn</dt><dd className="tabular">{r.fixedPricePerM2 === null ? `Giá nhập gần nhất · ${formatQty(r.tonQtyPerMeter)} ĐVT gốc/m dài (ưu tiên lượng BOM)` : `${formatCurrency(r.fixedPricePerM2)}/m² khổ gia công`}</dd></div>}
          <div><dt className="text-fg-secondary">Phí gia công</dt><dd className="tabular">{r.feePerMeter === null ? "Kế thừa mặc định kiểu" : `${formatCurrency(r.feePerMeter)}/m dài`}</dd></div>
        </dl>{r.note && <p className="mt-2 text-fg-secondary">{r.note}</p>}
      </article>)}
    </div>
  </FormCard>;
}
