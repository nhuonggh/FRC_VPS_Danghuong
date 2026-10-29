"use client";

import { ChevronDown, ChevronRight, FileUp, Settings2 } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Combobox, FormCard, FormGrid, inputClass, type ComboOption } from "@/components/ui";
import type { BadgeTone } from "@/components/ui/Badge";
import { toastApiError } from "@/lib/api-error-toast";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency } from "@/lib/format";
import type { CommitRow, LegacyOptions, LegacyPreview, Need, OrderStatus, PreviewOrder, Resolution } from "@/server/legacy-import/service";

type Preview = LegacyPreview & { fileErrors?: string[] };
type CommitResult = { rows: CommitRow[]; created: number; failed: number };
type AccountInfo = { accounts: { id: number; name: string; type: string }[]; canReceipt: boolean; canDeliver: boolean };

const STATUS: Record<OrderStatus, { label: string; tone: BadgeTone }> = {
  ready: { label: "Sẵn sàng", tone: "success" },
  "needs-input": { label: "Cần chọn", tone: "warning" },
  exists: { label: "Đã nhập", tone: "neutral" },
  error: { label: "Lỗi", tone: "danger" },
};
const DEFAULTS: LegacyOptions = { cashAccountId: null, createReceipts: true, deliver: false, unknownCustomer: "retail", missingStock: "allow" };
const STORE = "legacy-import.options.v1";
const rkey = (kind: string, key: string) => `${kind}:${key}`;

function loadOptions(): LegacyOptions {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORE) ?? "{}") as Partial<LegacyOptions>) }; } catch { return DEFAULTS; }
}

/** Nhập đơn bán từ "Báo cáo bán hàng hằng ngày" xuất ra từ phần mềm cũ: xem trước từng đơn, chọn cách xử lý, rồi ghi. */
export function LegacyImport() {
  const [file, setFile] = useState<File | null>(null);
  const [options, setOptions] = useState<LegacyOptions>(DEFAULTS);
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [types, setTypes] = useState<ComboOption[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, Resolution & { label: string }>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<CommitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const seenRef = useRef(new Set<string>());

  useEffect(() => { setOptions(loadOptions()); }, []);
  useEffect(() => {
    apiFetch<AccountInfo>("/api/legacy-import/cash-accounts").then((i) => {
      setInfo(i);
      setOptions((o) => ({ ...o, createReceipts: o.createReceipts && i.canReceipt, deliver: o.deliver && i.canDeliver, cashAccountId: o.cashAccountId ?? i.accounts.find((a) => a.type === "CASH")?.id ?? null }));
    }).catch(toastApiError);
    apiFetch<ComboOption[]>("/api/orders/options/processing-types").then(setTypes).catch(() => setTypes([]));
  }, []);

  const body = useCallback((extra?: Record<string, string>) => {
    const fd = new FormData();
    fd.set("file", file!);
    fd.set("options", JSON.stringify(options));
    fd.set("resolutions", JSON.stringify(Object.values(resolutions).map(({ kind, key, targetId }) => ({ kind, key, targetId }))));
    for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
    return fd;
  }, [file, options, resolutions]);

  // Mỗi lần đổi tệp / tùy chọn / lựa chọn ghép → xem trước lại (không ghi gì)
  useEffect(() => {
    if (!file) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const p = await apiFetch<Preview>("/api/legacy-import?mode=preview", { method: "POST", body: body() });
        if (mine !== seq.current) return;
        setPreview(p);
        setSelected((prev) => {
          const first = prev.size === 0;
          const next = new Set<string>();
          for (const o of p.orders) if (o.status === "ready" && (first || prev.has(o.code) || !seenRef.current.has(o.code))) next.add(o.code);
          p.orders.forEach((o) => seenRef.current.add(o.code));
          return next;
        });
      } catch (e) { if (mine === seq.current) { setPreview(null); toastApiError(e); } } finally { if (mine === seq.current) setBusy(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [file, body]);

  const set = <K extends keyof LegacyOptions>(k: K, v: LegacyOptions[K]) => setOptions((o) => { const n = { ...o, [k]: v }; try { localStorage.setItem(STORE, JSON.stringify(n)); } catch { /* không lưu được thì thôi */ } return n; });
  const choose = (f: File | null) => { setFile(f); setPreview(null); setResult(null); setSelected(new Set()); seenRef.current = new Set(); };
  const pick = (n: Need, targetId: number, label: string) => setResolutions((r) => ({ ...r, [rkey(n.kind, n.key)]: { kind: n.kind, key: n.key, targetId, label } }));

  async function commit() {
    if (!file || busy || selected.size === 0) return;
    setBusy(true);
    try {
      const r = await apiFetch<CommitResult>("/api/legacy-import?mode=commit", { method: "POST", body: body({ selected: JSON.stringify([...selected]) }) });
      setResult(r);
      seenRef.current = new Set();
      setSelected(new Set());
      setResolutions((x) => ({ ...x })); // kích hoạt xem trước lại: đơn vừa ghi chuyển sang "Đã nhập"
    } catch (e) { toastApiError(e); } finally { setBusy(false); }
  }

  const orders = useMemo(() => preview?.orders ?? [], [preview]);
  const totalSelected = useMemo(() => orders.filter((o) => selected.has(o.code)).reduce((s, o) => s + o.legacyTotal, 0), [orders, selected]);
  const toggle = (code: string) => setSelected((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  const toggleOpen = (code: string) => setOpen((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  const readyCodes = orders.filter((o) => o.status === "ready").map((o) => o.code);
  const lab = "mb-1 block text-xs font-medium text-fg-secondary";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Nhập đơn từ phần mềm cũ</h1>
        <p className="mt-1 text-sm text-fg-secondary">Chọn tệp “Báo cáo bán hàng hằng ngày” xuất từ phần mềm cũ. Hệ thống xem trước từng đơn; bạn chọn cách xử lý rồi mới ghi. Đơn đã nhập một lần sẽ không bị nhập trùng.</p>
      </div>

      <FormCard icon={FileUp} title="1. Tệp xuất từ phần mềm cũ">
        <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-strong p-4 text-center text-sm hover:bg-hover">
          <span>{file?.name ?? "Chọn hoặc kéo thả tệp BaoCaoBanHangHangNgay….xls"}</span>
          <input type="file" accept=".xls,.html,.htm" className="sr-only" aria-label="Chọn tệp báo cáo bán hàng" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
        </label>
        {preview?.fileErrors?.length ? <ul className="mt-2 list-disc pl-5 text-xs text-danger">{preview.fileErrors.map((m) => <li key={m}>{m}</li>)}</ul> : null}
      </FormCard>

      <FormCard icon={Settings2} title="2. Tùy chọn nhập (nhớ cho lần sau)">
        <FormGrid cols={3}>
          <div>
            <label htmlFor="li-receipt" className="flex min-h-11 items-center gap-2 text-sm"><input id="li-receipt" type="checkbox" checked={options.createReceipts} disabled={!info?.canReceipt} onChange={(e) => set("createReceipts", e.target.checked)} />Tạo phiếu thu cho số đã thanh toán</label>
            {info && !info.canReceipt && <p className="text-xs text-fg-muted">Bạn chưa có quyền tạo phiếu thu.</p>}
          </div>
          <div>
            <label htmlFor="li-cash" className={lab}>Quỹ nhận tiền</label>
            <select id="li-cash" className={inputClass()} disabled={!options.createReceipts} value={options.cashAccountId ?? ""} onChange={(e) => set("cashAccountId", e.target.value ? Number(e.target.value) : null)}>
              <option value="">— Chọn quỹ —</option>
              {info?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="li-deliver" className={lab}>Giao hàng</label>
            <select id="li-deliver" className={inputClass()} disabled={!info?.canDeliver} value={options.deliver ? "now" : "later"} onChange={(e) => set("deliver", e.target.value === "now")}>
              <option value="later">Chưa giao (chỉ lập đơn)</option>
              <option value="now">Giao luôn (xuất kho ngay)</option>
            </select>
          </div>
          <div>
            <label htmlFor="li-unknown" className={lab}>Khách chưa có trong hệ thống</label>
            <select id="li-unknown" className={inputClass()} value={options.unknownCustomer} onChange={(e) => set("unknownCustomer", e.target.value as LegacyOptions["unknownCustomer"])}>
              <option value="retail">Tạo khách lẻ thân quen theo SĐT (khách nhóm thợ vẫn phải chọn tay)</option>
              <option value="manual">Bắt chọn tay</option>
            </select>
          </div>
          <div>
            <label htmlFor="li-stock" className={lab}>Đơn thiếu tồn kho</label>
            <select id="li-stock" className={inputClass()} value={options.missingStock} onChange={(e) => set("missingStock", e.target.value as LegacyOptions["missingStock"])}>
              <option value="allow">Vẫn ghi, thành đơn treo</option>
              <option value="block">Chặn, không ghi đơn đó</option>
            </select>
          </div>
        </FormGrid>
      </FormCard>

      {file && (
        <FormCard title={`3. Xem trước${preview ? ` (${orders.length} đơn)` : ""}`} actions={preview && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {(Object.keys(STATUS) as OrderStatus[]).map((s) => <Badge key={s} tone={STATUS[s].tone}>{STATUS[s].label}: {preview.counts[s]}</Badge>)}
            <button type="button" className="h-9 rounded-sm border border-border px-3 hover:bg-hover" onClick={() => setSelected(new Set(readyCodes))}>Chọn đơn sẵn sàng</button>
            <button type="button" className="h-9 rounded-sm border border-border px-3 hover:bg-hover" onClick={() => setSelected(new Set())}>Bỏ chọn</button>
          </div>
        )}>
          {busy && !preview && <p className="text-sm text-fg-secondary">Đang đọc tệp…</p>}
          {preview && (
            <div className="overflow-auto rounded-sm border border-border">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="sticky top-0 bg-surface text-xs text-fg-secondary">
                  <tr><th className="w-10 p-2" /><th className="p-2">Mã đơn cũ</th><th className="p-2">Khách hàng</th><th className="p-2 text-right">Tiền (cũ)</th><th className="p-2 text-right">Tiền (mới)</th><th className="p-2 text-right">Đã thu</th><th className="p-2">Trạng thái</th></tr>
                </thead>
                <tbody>
                  {orders.map((o) => <OrderRow key={o.code} o={o} checked={selected.has(o.code)} opened={open.has(o.code)} onCheck={() => toggle(o.code)} onOpen={() => toggleOpen(o.code)} types={types} onPick={pick} resolutions={resolutions} />)}
                </tbody>
              </table>
            </div>
          )}
          {preview && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-fg-secondary">Đã chọn <strong>{selected.size}</strong> đơn · tổng tiền cũ {formatCurrency(totalSelected)}</p>
              <button type="button" onClick={() => void commit()} disabled={busy || selected.size === 0} className="inline-flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-50 md:h-10">{busy ? "Đang xử lý…" : `Nhập ${selected.size} đơn`}</button>
            </div>
          )}
        </FormCard>
      )}

      {result && (
        <FormCard title={`Kết quả: tạo ${result.created} đơn, lỗi ${result.failed}`}>
          <ul className="space-y-1 text-sm">
            {result.rows.map((r) => <li key={r.code} className={r.ok ? "" : "text-danger"}>{r.code} → {r.ok ? `đã tạo ${r.orderCode}` : r.error}</li>)}
          </ul>
        </FormCard>
      )}
    </div>
  );
}

function OrderRow({ o, checked, opened, onCheck, onOpen, types, onPick, resolutions }: {
  o: PreviewOrder; checked: boolean; opened: boolean; onCheck: () => void; onOpen: () => void; types: ComboOption[];
  onPick: (n: Need, targetId: number, label: string) => void; resolutions: Record<string, Resolution & { label: string }>;
}) {
  const diff = o.ourTotal !== null && o.ourTotal !== o.legacyTotal;
  const expand = opened || o.status === "needs-input" || o.status === "error";
  return (
    <Fragment>
      <tr className="border-t border-border align-top">
        <td className="p-2"><input type="checkbox" aria-label={`Chọn đơn ${o.code}`} checked={checked} disabled={o.status !== "ready"} onChange={onCheck} /></td>
        <td className="p-2"><button type="button" onClick={onOpen} className="flex items-center gap-1 font-medium text-accent">{expand ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}{o.code}</button><div className="text-xs text-fg-muted">{o.date}</div></td>
        <td className="p-2">{o.customer}<div className="text-xs text-fg-muted">{[o.group, o.phones[0]].filter(Boolean).join(" · ")}</div>{o.partner && <div className="text-xs text-fg-secondary">→ {o.partner}</div>}</td>
        <td className="tabular p-2 text-right">{formatCurrency(o.legacyTotal)}</td>
        <td className={`tabular p-2 text-right ${diff ? "text-warning" : ""}`}>{o.ourTotal === null ? "—" : formatCurrency(o.ourTotal)}</td>
        <td className="tabular p-2 text-right">{formatCurrency(o.paid)}</td>
        <td className="p-2"><Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge></td>
      </tr>
      {expand && (
        <tr className="border-t border-border bg-hover/30">
          <td />
          <td colSpan={6} className="space-y-3 p-3">
            {o.issues.length > 0 && <ul className="list-disc pl-5 text-xs text-danger">{o.issues.map((m) => <li key={m}>{m}</li>)}</ul>}
            {o.needs.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {o.needs.map((n) => <NeedPicker key={rkey(n.kind, n.key)} n={n} types={types} chosen={resolutions[rkey(n.kind, n.key)]?.label} onPick={onPick} />)}
              </div>
            )}
            {o.lines.length > 0 && (
              <table className="w-full text-xs">
                <thead className="text-fg-secondary"><tr><th className="py-1 text-left">Hàng (phần mềm cũ)</th><th className="text-left">Kiểu</th><th className="text-right">SL</th><th className="text-right">Đơn giá</th><th className="pl-3 text-left">Sản phẩm trong hệ thống</th></tr></thead>
                <tbody>
                  {o.lines.map((l, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="py-1">{l.name}</td><td>{l.kind || "—"}</td>
                      <td className="tabular text-right">{l.qty} {l.unit}</td><td className="tabular text-right">{formatCurrency(l.price)}</td>
                      <td className={`pl-3 ${l.issue ? "text-danger" : ""}`}>{l.issue ?? l.product}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function NeedPicker({ n, types, chosen, onPick }: { n: Need; types: ComboOption[]; chosen: string | undefined; onPick: (n: Need, targetId: number, label: string) => void }) {
  const [value, setValue] = useState<ComboOption | null>(null);
  const title = n.kind === "PRODUCT" ? "Sản phẩm" : n.kind === "PARTNER" ? "Khách hàng" : "Kiểu gia công";
  const load = (q: string) => apiFetch<ComboOption[]>(n.kind === "PRODUCT" ? `/api/products/search?capability=canSell&q=${encodeURIComponent(q)}` : `/api/partner-lists/customers/search?q=${encodeURIComponent(q)}`);
  return (
    <div className="rounded-sm border border-border bg-surface p-2">
      <p className="mb-1 text-xs text-fg-secondary">{title} cũ: <strong className="text-fg">{n.label}</strong>{chosen && <span className="ml-1 text-success">→ {chosen}</span>}</p>
      {n.kind === "PROCESSING" ? (
        <select aria-label={`Chọn ${title.toLowerCase()} cho ${n.label}`} className={inputClass()} value="" onChange={(e) => { const v = e.target.value; if (v === "") return; onPick(n, Number(v), v === "0" ? "Không kiểu gia công" : types.find((t) => String(t.value) === v)?.label ?? v); }}>
          <option value="">— Chọn kiểu gia công trong hệ thống —</option>
          <option value="0">Không có kiểu gia công</option>
          {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      ) : (
        <Combobox hideLabel label={`Chọn ${title.toLowerCase()} cho ${n.label}`} value={value} loadOptions={load} placeholder={`Tìm ${title.toLowerCase()} trong hệ thống…`} onChange={(o) => { setValue(o); if (o) onPick(n, Number(o.value), o.label); }} />
      )}
    </div>
  );
}
