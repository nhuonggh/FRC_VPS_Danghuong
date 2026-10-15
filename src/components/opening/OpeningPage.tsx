"use client";
import { FlaskConical, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ImportDialog } from "@/components/import/ImportDialog";
import { Badge, EmptyState, StatCard } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatQty } from "@/lib/format";
import type { OpeningListDTO } from "@/server/opening/queries";
import { OPENING_TITLE, type OpeningKind } from "@/server/opening/kinds";

const HINT: Record<OpeningKind, string> = {
  stock: "Mỗi mã một lô đầu kỳ: số lượng theo đơn vị gốc và giá vốn trên đơn vị gốc. Bán hàng sau đó xuất theo đúng giá vốn lô này.",
  material: "Nguyên vật liệu (tôn cuộn, keo, hạt xốp…): số lượng theo đơn vị gốc và giá vốn trên đơn vị gốc.",
  debt: "Số dương = khách nợ mình (phải thu). Số âm = mình nợ nhà cung cấp (phải trả). Mỗi đối tác một dòng, chốt tại ngày chuyển đổi.",
  cash: "Số dư từng quỹ tiền mặt / tài khoản ngân hàng tại ngày chốt (tên quỹ phải khớp danh mục).",
  discount: "Chiết khấu tích lũy công ty còn nợ từng khách tại ngày chốt (chưa tất toán).",
};

const DEMO_NOTE = "Số demo — sẽ reset khi chạy chính thức";

export function OpeningPage({ kind, data, canForce, onlyDemo = false }: { kind: OpeningKind; data: OpeningListDTO; canForce: boolean; onlyDemo?: boolean }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [force, setForce] = useState(false);
  const [busy, setBusy] = useState<"load" | "reset" | null>(null); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const base = `/period/opening-${kind === "material" ? "materials" : kind}`;
  async function demo(action: "load" | "reset") {
    if (busy) return;
    if (action === "reset" && !window.confirm("Xóa TOÀN BỘ số demo đầu kỳ (công nợ, tồn kho, quỹ, chiết khấu)? Số thật nhập từ Excel được giữ nguyên.")) return;
    setBusy(action); setMsg(null);
    try {
      const r = await apiFetch<{ total: number; stock: number; debt: number; cash: number; discount: number; skipped?: number }>("/api/opening/demo", { method: "POST", json: { action } });
      setMsg({ ok: true, text: `${action === "load" ? "Đã nạp" : "Đã xóa"} số demo: tồn kho ${r.stock}, công nợ ${r.debt}, quỹ ${r.cash}, chiết khấu ${r.discount}.${r.skipped ? ` Bỏ qua ${r.skipped} dòng (đã có số hoặc không khớp danh mục).` : ""}` });
      router.refresh();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Không thực hiện được." }); } finally { setBusy(null); }
  }
  const stockLike = kind === "stock" || kind === "material";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{OPENING_TITLE[kind]}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/api/opening/${kind}/template`} className="flex h-11 items-center rounded-sm border border-border px-3 text-sm hover:bg-hover md:h-10">Tải tệp mẫu</a>
          <button type="button" onClick={() => setOpen(true)} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Upload size={16} aria-hidden />Nhập từ Excel</button>
        </div>
      </div>
      <p className="text-sm text-fg-secondary">{HINT[kind]} Kỳ: <strong>{data.periodName}</strong>. Nhập xong chỉ chỉnh được bằng cách nhập lại với “Ghi đè”.</p>
      <section aria-label="Số liệu demo" className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-dashed border-border bg-surface p-3 text-sm">
        <p className="flex items-center gap-2 text-fg-secondary"><FlaskConical size={16} aria-hidden className="text-accent" /><span><strong>Số demo</strong> để test: {data.demoCount} / {data.allCount} dòng ở màn này. Reset khi chạy chính thức.</span></p>
        <div className="flex flex-wrap items-center gap-2">
          {data.demoCount > 0 || onlyDemo ? <Link href={onlyDemo ? base : `${base}?demo=1`} className={`flex h-11 items-center rounded-sm border px-3 text-sm md:h-10 ${onlyDemo ? "border-accent bg-accent-soft font-medium text-accent" : "border-border hover:bg-hover"}`} aria-pressed={onlyDemo}>Chỉ hiện số demo</Link> : null}
          {canForce && <button type="button" onClick={() => void demo("load")} disabled={busy !== null} className="flex h-11 items-center gap-2 rounded-sm border border-border px-3 text-sm hover:bg-hover disabled:opacity-60 md:h-10"><FlaskConical size={16} aria-hidden />{busy === "load" ? "Đang nạp…" : "Nạp số demo"}</button>}
          {canForce && <button type="button" onClick={() => void demo("reset")} disabled={busy !== null} className="flex h-11 items-center gap-2 rounded-sm border border-danger px-3 text-sm text-danger hover:bg-danger-soft disabled:opacity-60 md:h-10"><Trash2 size={16} aria-hidden />{busy === "reset" ? "Đang xóa…" : "Reset số demo"}</button>}
        </div>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`w-full text-sm ${msg.ok ? "text-fg-secondary" : "text-danger"}`}>{msg.text}</p>}
      </section>
      {data.hasDocs && (
        <div role="status" className="rounded-sm border border-warning bg-warning-soft p-3 text-sm">
          Kỳ này đã có chứng từ nên không nhập thêm số đầu kỳ được.{canForce ? " Giám đốc có thể tích ô bên dưới để nhập." : ""}
          {canForce && <label className="mt-2 flex min-h-11 items-center gap-2"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />Cho phép khi kỳ đã có chứng từ</label>}
        </div>
      )}
      <div className="flex flex-wrap gap-3"><StatCard label="Số dòng" value={data.rows.length} /><div className="flex min-w-32 flex-1 flex-col gap-1 rounded-md border border-border bg-surface p-3"><span className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">{stockLike ? "Tổng giá trị tồn" : "Tổng số dư"}</span><span className="tabular text-2xl font-bold">{formatCurrency(data.total)}</span></div></div>
      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        {data.rows.length === 0 ? <EmptyState kind="empty" title="Chưa nhập số đầu kỳ" description="Tải tệp mẫu, điền dữ liệu rồi bấm Nhập từ Excel." /> : (
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-2">{kind === "cash" ? "Số TK" : "Mã"}</th><th className="px-3 py-2">Tên</th>{stockLike && <><th className="px-3 py-2 text-right">Số lượng</th><th className="px-3 py-2 text-right">Giá vốn</th></>}<th className="px-3 py-2 text-right">{stockLike ? "Thành tiền" : "Số dư"}</th></tr></thead>
            <tbody>{data.rows.map((r) => <tr key={r.id} className="border-t border-border"><td className="px-3 py-2 font-mono text-xs">{r.code}</td><td className="px-3 py-2">{r.name}{r.isDemo && <> <Badge tone="warning">Demo</Badge><span className="block text-xs text-fg-muted">{DEMO_NOTE}</span></>}</td>{stockLike && <><td className="px-3 py-2 text-right tabular">{formatQty(r.qty!)}</td><td className="px-3 py-2 text-right tabular">{formatCurrency(r.unitCost!)}</td></>}<td className="px-3 py-2 text-right tabular">{formatCurrency(r.amount)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      <ImportDialog open={open} onClose={() => setOpen(false)} onDone={() => router.refresh()} title={`Nhập ${OPENING_TITLE[kind].toLowerCase()} từ Excel`} endpoint={`/api/opening/${kind}/import${force ? "?force=1" : ""}`} templateHref={`/api/opening/${kind}/template`} />
    </div>
  );
}
