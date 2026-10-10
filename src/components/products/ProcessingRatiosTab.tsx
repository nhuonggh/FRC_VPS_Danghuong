"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { inputClass } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "@/lib/toast";

interface Row { processingTypeId: number; name: string; linked: boolean; ratio: string | null; defaultRatio: string | null }

const trim = (v: string | null) => v?.replace(/\.?0+$/, "") ?? "";

/**
 * Kiểu gia công của riêng sản phẩm này: chỉ các kiểu đã gắn mới hiện ở màn bán hàng. Chọn thêm từ danh sách chung
 * (Cài đặt danh mục → Kiểu gia công). Tỷ lệ m²/md để trống ⇒ dùng mặc định của kiểu (chưa có nữa thì màn bán dùng 1).
 */
export function ProcessingRatiosTab({ productId, canManage }: { productId: number; canManage: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [pick, setPick] = useState("");
  const url = `/api/products/${productId}/processing-ratios`;
  useEffect(() => { apiFetch<Row[]>(url).then(setRows).catch(() => setRows([])); }, [url]);
  const patch = (id: number, p: Partial<Row>) => setRows((all) => (all ?? []).map((x) => (x.processingTypeId === id ? { ...x, ...p } : x)));

  const link = async (id: number) => {
    try {
      await apiFetch(url, { method: "PATCH", json: { processingTypeId: id, ratio: null } });
      patch(id, { linked: true, ratio: null }); setPick(""); toast.success("Đã thêm kiểu gia công.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Không thêm được."); }
  };
  const saveRatio = async (r: Row) => {
    const text = (draft[r.processingTypeId] ?? "").trim().replace(",", ".");
    try {
      const res = await apiFetch<{ ratio: string | null }>(url, { method: "PATCH", json: { processingTypeId: r.processingTypeId, ratio: text === "" ? null : Number(text) } });
      patch(r.processingTypeId, { ratio: res.ratio });
      setDraft((d) => { const n = { ...d }; delete n[r.processingTypeId]; return n; });
      toast.success("Đã lưu tỷ lệ.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Không lưu được."); }
  };
  const unlink = async (r: Row) => {
    try {
      await apiFetch(url, { method: "DELETE", json: { processingTypeId: r.processingTypeId } });
      patch(r.processingTypeId, { linked: false, ratio: null }); toast.success("Đã bỏ kiểu gia công.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Không bỏ được."); }
  };

  if (!rows) return <p className="text-sm text-fg-muted">Đang tải…</p>;
  const linked = rows.filter((r) => r.linked);
  const rest = rows.filter((r) => !r.linked);
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-secondary">Kiểu gia công của sản phẩm này. Chỉ các kiểu dưới đây mới hiện ở màn bán hàng; chưa có kiểu nào thì sản phẩm bán như hàng thường. Tỷ lệ m²/md để trống thì dùng tỷ lệ mặc định của kiểu.</p>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Chọn kiểu gia công để thêm" value={pick} onChange={(e) => setPick(e.target.value)} className={`${inputClass()} w-full max-w-xs cursor-pointer`}>
            <option value="">— Chọn kiểu gia công —</option>
            {rest.map((r) => <option key={r.processingTypeId} value={r.processingTypeId}>{r.name}</option>)}
          </select>
          <button type="button" disabled={!pick} onClick={() => link(Number(pick))} className="h-9 rounded-sm bg-accent px-3 text-sm font-medium text-fg-on-accent disabled:opacity-40">Thêm kiểu gia công</button>
        </div>
      )}
      <div className="overflow-x-auto rounded-sm border border-border">
        <table className="w-full min-w-[480px] text-sm">
          <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-2">Kiểu gia công</th><th className="px-3 py-2 text-right">Tỷ lệ m²/md</th><th className="px-3 py-2" /></tr></thead>
          <tbody>
            {linked.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-fg-muted">Chưa gắn kiểu gia công nào.</td></tr>}
            {linked.map((r) => (
              <tr key={r.processingTypeId} className="border-t border-border">
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-right">
                  <input aria-label={`Tỷ lệ ${r.name}`} inputMode="decimal" disabled={!canManage} placeholder={r.defaultRatio ? `mặc định ${trim(r.defaultRatio)}` : "mặc định 1"} value={draft[r.processingTypeId] ?? trim(r.ratio)}
                    onChange={(e) => setDraft((d) => ({ ...d, [r.processingTypeId]: e.target.value }))} className={`${inputClass()} ml-auto w-36 tabular text-right`} />
                </td>
                <td className="px-3 py-2 text-right">
                  {canManage && (
                    <span className="inline-flex items-center gap-2">
                      {draft[r.processingTypeId] !== undefined && <button type="button" onClick={() => saveRatio(r)} className="h-9 rounded-sm bg-accent px-3 text-sm font-medium text-fg-on-accent">Lưu</button>}
                      <button type="button" aria-label={`Bỏ ${r.name}`} onClick={() => unlink(r)} className="inline-flex h-9 w-9 items-center justify-center rounded-sm text-danger hover:bg-hover"><Trash2 size={16} aria-hidden /></button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
