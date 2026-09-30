"use client";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ImportDialog } from "@/components/import/ImportDialog";
import { EmptyState, StatCard } from "@/components/ui";
import { formatCurrency, formatQty } from "@/lib/format";
import type { OpeningListDTO } from "@/server/opening/queries";
import type { OpeningKind } from "@/server/opening/registry";
import { OPENING_TITLE } from "@/server/opening/registry";

const HINT: Record<OpeningKind, string> = {
  stock: "Mỗi mã một lô đầu kỳ: số lượng theo đơn vị gốc và giá vốn trên đơn vị gốc. Bán hàng sau đó xuất theo đúng giá vốn lô này.",
  material: "Nguyên vật liệu (tôn cuộn, keo, hạt xốp…): số lượng theo đơn vị gốc và giá vốn trên đơn vị gốc.",
  debt: "Số dương = khách nợ mình (phải thu). Số âm = mình nợ nhà cung cấp (phải trả). Mỗi đối tác một dòng, chốt tại ngày chuyển đổi.",
  cash: "Số dư từng quỹ tiền mặt / tài khoản ngân hàng tại ngày chốt (tên quỹ phải khớp danh mục).",
  discount: "Chiết khấu tích lũy công ty còn nợ từng khách tại ngày chốt (chưa tất toán).",
};

export function OpeningPage({ kind, data, canForce }: { kind: OpeningKind; data: OpeningListDTO; canForce: boolean }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [force, setForce] = useState(false);
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
            <tbody>{data.rows.map((r) => <tr key={r.id} className="border-t border-border"><td className="px-3 py-2 font-mono text-xs">{r.code}</td><td className="px-3 py-2">{r.name}</td>{stockLike && <><td className="px-3 py-2 text-right tabular">{formatQty(r.qty!)}</td><td className="px-3 py-2 text-right tabular">{formatCurrency(r.unitCost!)}</td></>}<td className="px-3 py-2 text-right tabular">{formatCurrency(r.amount)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
      <ImportDialog open={open} onClose={() => setOpen(false)} onDone={() => router.refresh()} title={`Nhập ${OPENING_TITLE[kind].toLowerCase()} từ Excel`} endpoint={`/api/opening/${kind}/import${force ? "?force=1" : ""}`} templateHref={`/api/opening/${kind}/template`} />
    </div>
  );
}
