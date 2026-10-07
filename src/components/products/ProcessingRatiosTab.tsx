"use client";

import { useEffect, useState } from "react";
import { inputClass } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "@/lib/toast";

interface Row { processingTypeId: number; name: string; ratio: string | null }

/** Tỷ lệ m²/md theo kiểu gia công (bán tôn theo kích thước). Chưa khai báo ⇒ màn bán dùng 1; người bán nhập lần đầu sẽ được lưu ở đây. */
export function ProcessingRatiosTab({ productId, canManage }: { productId: number; canManage: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [draft, setDraft] = useState<Record<number, string>>({});
  useEffect(() => { apiFetch<Row[]>(`/api/products/${productId}/processing-ratios`).then(setRows).catch(() => setRows([])); }, [productId]);
  const save = async (r: Row) => {
    const v = Number((draft[r.processingTypeId] ?? r.ratio ?? "").replace(",", "."));
    try {
      const res = await apiFetch<{ ratio: string }>(`/api/products/${productId}/processing-ratios`, { method: "PATCH", json: { processingTypeId: r.processingTypeId, ratio: v } });
      setRows((all) => (all ?? []).map((x) => (x.processingTypeId === r.processingTypeId ? { ...x, ratio: res.ratio } : x)));
      setDraft((d) => { const n = { ...d }; delete n[r.processingTypeId]; return n; });
      toast.success("Đã lưu tỷ lệ.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Không lưu được."); }
  };
  if (!rows) return <p className="text-sm text-fg-muted">Đang tải…</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-secondary">Tỷ lệ m²/md theo kiểu gia công (vd 1,08). Chưa khai báo thì màn bán hàng dùng 1; người bán nhập lần đầu sẽ được lưu tại đây, muốn đổi thì sửa ở đây.</p>
      <div className="overflow-x-auto rounded-sm border border-border">
        <table className="w-full min-w-[420px] text-sm">
          <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-2">Kiểu gia công</th><th className="px-3 py-2 text-right">Tỷ lệ m²/md</th><th className="px-3 py-2" /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.processingTypeId} className="border-t border-border">
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-right">
                  <input aria-label={`Tỷ lệ ${r.name}`} inputMode="decimal" disabled={!canManage} placeholder="chưa khai báo" value={draft[r.processingTypeId] ?? r.ratio?.replace(/\.?0+$/, "") ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [r.processingTypeId]: e.target.value }))} className={`${inputClass()} ml-auto w-32 tabular text-right`} />
                </td>
                <td className="px-3 py-2 text-right">{canManage && draft[r.processingTypeId] !== undefined && <button type="button" onClick={() => save(r)} className="h-9 rounded-sm bg-accent px-3 text-sm font-medium text-fg-on-accent">Lưu</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
