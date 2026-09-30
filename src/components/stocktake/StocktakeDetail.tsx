"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DetailField, DetailPage, ReasonDialog, useDetailNav } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatDate, formatQty } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { StocktakeDetailDTO } from "@/server/stocktake/queries";
import { STOCKTAKE_LABEL } from "./labels";

const TONE = { DRAFT: "warning", DONE: "success", CANCELLED: "danger" } as const;
export function StocktakeDetail({ st }: { st: StocktakeDetailDTO }) {
  const router = useRouter(), nav = useDetailNav(["info"]), idem = useIdempotencyKey();
  const [cancelOpen, setCancelOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const showCost = st.lines.some((l) => l.unitCost !== undefined);
  const nonZero = st.lines.filter((l) => l.diff !== null && Number(l.diff) !== 0).length;
  async function confirm() {
    setBusy(true); setError(null);
    try { await apiFetch(`/api/stocktakes/${st.id}/confirm`, { method: "POST", idempotencyKey: idem.key }); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Không chốt được phiếu."); }
    finally { setBusy(false); }
  }
  async function cancel(reason: string) { await apiFetch(`/api/stocktakes/${st.id}/cancel`, { method: "POST", json: { reason } }); router.refresh(); }
  const actions = st.status === "CANCELLED" ? undefined : (
    <div className="flex gap-2">
      {st.status === "DRAFT" && <Link href={`/inventory/stocktakes/${st.id}/edit`} className="flex h-10 items-center rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover">Sửa nháp</Link>}
      {st.status === "DRAFT" && <button type="button" disabled={busy} onClick={confirm} className="h-10 rounded-sm bg-accent px-3 text-sm font-medium text-fg-on-accent disabled:opacity-60">Chốt phiếu</button>}
      <button type="button" onClick={() => setCancelOpen(true)} className="h-10 rounded-sm border border-danger px-3 text-sm font-medium text-danger">Hủy phiếu</button>
    </div>
  );
  return (
    <div className="space-y-4">
      {st.status === "CANCELLED" && <div role="status" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">Phiếu đã hủy. Lý do: {st.cancelReason}.</div>}
      {error && <div role="alert" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">{error}</div>}
      <DetailPage
        backHref="/inventory/stocktakes" backLabel="Quay lại kiểm kho" headerActions={actions}
        summary={{ title: st.code, code: "Phiếu kiểm kho", badges: [{ label: STOCKTAKE_LABEL[st.status], tone: TONE[st.status] }], facts: [{ label: "Ngày kiểm", value: formatDate(st.at) }, { label: "Số dòng", value: st.lines.length }, { label: "Dòng lệch", value: nonZero }, { label: "Người lập", value: st.createdByName ?? "—" }] }}
        tabs={[{ key: "info", label: "Chi tiết", render: () => (
          <div className="space-y-5">
            <dl><DetailField label="Ghi chú">{st.note}</DetailField></dl>
            {st.status === "DRAFT" && <p className="text-sm text-fg-secondary">Tồn sổ sách bên dưới là tồn hiện tại; con số chốt là tồn tại thời điểm bấm “Chốt phiếu”.</p>}
            <div className="overflow-x-auto rounded-sm border border-border">
              <table className="w-full min-w-[620px] text-sm">
                <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-2">Sản phẩm</th><th className="px-3 py-2 text-right">Tồn sổ sách</th><th className="px-3 py-2 text-right">Thực đếm</th><th className="px-3 py-2 text-right">Chênh lệch</th>{showCost && <th className="px-3 py-2 text-right">Giá nhập hàng thừa</th>}</tr></thead>
                <tbody>{st.lines.map((l) => {
                  const d = l.diff === null ? null : Number(l.diff);
                  return <tr key={l.id} className="border-t border-border"><td className="px-3 py-2"><span className="font-mono text-xs">{l.productCode}</span> {l.productName}</td><td className="px-3 py-2 text-right tabular">{l.systemQty === null ? "—" : `${formatQty(l.systemQty)} ${l.baseUnit}`}</td><td className="px-3 py-2 text-right tabular">{formatQty(l.actualQty)} {l.baseUnit}</td><td className={`px-3 py-2 text-right tabular ${d && d < 0 ? "text-danger" : d && d > 0 ? "text-success" : ""}`}>{d === null ? "—" : `${d > 0 ? "+" : ""}${formatQty(l.diff!)}`}</td>{showCost && <td className="px-3 py-2 text-right tabular">{l.unitCost ? formatCurrency(l.unitCost) : "—"}</td>}</tr>;
                })}</tbody>
              </table>
            </div>
          </div>
        ) }]}
        {...nav}
      />
      <ReasonDialog open={cancelOpen} onClose={() => setCancelOpen(false)} title={`Hủy phiếu ${st.code}?`} description={st.status === "DONE" ? "Phần nhập/xuất chênh lệch của phiếu sẽ được gỡ khỏi kho." : "Phiếu nháp sẽ không còn hiệu lực."} confirmLabel="Hủy phiếu" onConfirm={cancel} />
    </div>
  );
}
