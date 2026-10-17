"use client";
import Link from "next/link";
import type { SalePricingDTO } from "@/server/sales/pricing";
import type { CostSource } from "@/server/sales/cost-reference";
import { formatCurrency, formatDate, formatQty } from "@/lib/format";

export const referencePerBase = (dto: SalePricingDTO | null | undefined) => dto?.costReference ? dto.costReference.primary?.perBase ?? null : dto?.lastPurchasePrice ?? null;
const labels = { PURCHASE: "Nhập mua gần nhất", PRODUCTION: "Sản xuất gần nhất", BOM: "Dự kiến theo định mức" };
export function CostReferenceInfo({ dto, unit, divisor = 1, compact = false }: { dto: SalePricingDTO | null; unit: string; divisor?: number; compact?: boolean }) {
  const ref = dto?.costReference;
  if (!ref && dto?.lastPurchasePrice == null) return null;
  const divide = divisor > 0 ? divisor : 1;
  const money = (v: string | null) => v === null ? "Chưa đủ dữ liệu" : `${formatCurrency(Number(v) / divide)}/${unit}`;
  const source = (s: CostSource) => <span>{labels[s.kind]} · {s.href ? <Link href={s.href} target="_blank" rel="noopener noreferrer" className="text-accent">{s.code}</Link> : s.code} · {s.kind === "BOM" ? "Hiệu lực " : ""}{formatDate(s.at)}</span>;
  return <div className={compact ? "text-xs text-fg-secondary" : "rounded-sm border border-dashed border-border bg-canvas px-3 py-2 text-sm"}>
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1"><span>Giá vốn tham khảo</span><strong className="tabular">{money(referencePerBase(dto))}</strong></div>
    {ref?.primary && <p className="mt-1 text-xs text-fg-secondary">{source(ref.primary)}</p>}
    {ref?.message && (!compact || ref.primary?.perBase === null || !ref.primary) && <p className={`mt-1 text-xs ${ref.primary?.perBase == null ? "text-warning" : "text-fg-secondary"}`}>{ref.message}</p>}
    {ref && (!!ref.materials?.length || !!ref.alternatives.length) && <details className="mt-1"><summary className="min-h-11 cursor-pointer content-center text-xs text-accent md:min-h-9">Chi tiết giá vốn</summary><div className="space-y-2 pb-2 text-xs">
      {ref.alternatives.map(s => <p key={s.kind}>{source(s)}: <b className="tabular">{money(s.perBase)}</b></p>)}
      {ref.materials?.map(m => <div key={m.code} className="border-t border-border pt-2"><p>{m.code} · {m.name}</p><p className="tabular">{formatQty(Number(m.qty) / divide)} {m.unit}/{unit} × {m.price === null ? "Chưa có giá nhập" : `${formatCurrency(m.price)}/${m.unit}`} = {m.amount === null ? "Chưa tính được" : `${formatCurrency(Number(m.amount) / divide)}/${unit}`}</p>{m.at && <p className="text-fg-secondary">Giá nhập ngày {formatDate(m.at)}</p>}</div>)}
      {ref.primary?.kind === "BOM" && <p className="text-fg-secondary">Chỉ tính nguyên vật liệu, chưa gồm nhân công và chi phí khác.</p>}
    </div></details>}
  </div>;
}
