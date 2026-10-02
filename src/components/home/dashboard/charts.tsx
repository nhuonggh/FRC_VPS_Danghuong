import Link from "next/link";
import clsx from "clsx";
import type { BarSeries, DashFormat, RankItem, Slice } from "@/server/home/dashboard/types";
import { compact, fmt, niceMax, SLICE_VARS, TONE_VAR } from "./format";

const W = 720, H = 260, MT = 12, MB = 28, ML = 52;

function Legend({ items }: { items: { name: string; color: string; line?: boolean }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary" aria-label="Chú giải">
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-1.5">
          <span aria-hidden className={clsx("inline-block", i.line ? "h-0.5 w-3" : "h-2.5 w-2.5 rounded-sm")} style={{ background: i.color }} />
          {i.name}
        </li>
      ))}
    </ul>
  );
}

/** Cột nhóm + (tuỳ chọn) đường thứ hai với trục phải riêng. SVG thuần, màu theo token, tooltip bằng <title>. */
export function BarLineChart({ labels, bars, line, barFormat }: { labels: string[]; bars: BarSeries[]; line?: BarSeries; barFormat: DashFormat }) {
  const n = labels.length;
  const MR = line ? 52 : 12;
  const iw = W - ML - MR, ih = H - MT - MB;
  const barMax = Math.max(niceMax(Math.max(0, ...bars.flatMap((s) => s.values))), (bars[0]?.format ?? barFormat) === "count" ? 4 : 0);
  const lineVals = line?.values ?? [];
  // đường đếm số nguyên: trục tối thiểu 0–4 để nhãn không ra số lẻ (0,3)
  const lineHi = Math.max(niceMax(Math.max(0, ...lineVals)), (line?.format ?? "count") === "count" ? 4 : 0);
  const lineLo = Math.min(0, ...lineVals) < 0 ? -niceMax(-Math.min(0, ...lineVals)) : 0;
  const yBar = (v: number) => MT + ih - (v / barMax) * ih;
  const yLine = (v: number) => MT + ih - ((v - lineLo) / (lineHi - lineLo || 1)) * ih;
  const gw = iw / Math.max(n, 1);
  const bw = Math.min(28, (gw * 0.72) / Math.max(bars.length, 1));
  const step = Math.ceil(n / 14);
  const ticks = [0, 1, 2, 3, 4];

  return (
    <div>
      <Legend items={[...bars.map((s) => ({ name: s.name, color: TONE_VAR[s.tone] })), ...(line ? [{ name: line.name, color: TONE_VAR[line.tone], line: true }] : [])]} />
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={bars.map((s) => s.name).join(", ")} className="h-auto w-full min-w-[520px]">
          {ticks.map((t) => {
            const y = MT + ih - (t / 4) * ih;
            return (
              <g key={t}>
                <line x1={ML} x2={W - MR} y1={y} y2={y} stroke="var(--border-default)" strokeDasharray={t === 0 ? undefined : "3 3"} />
                <text x={ML - 6} y={y + 4} textAnchor="end" fontSize="11" fill="var(--text-secondary)">{compact((barMax * t) / 4)}</text>
                {line && <text x={W - MR + 6} y={y + 4} fontSize="11" fill="var(--text-secondary)">{compact(lineLo + ((lineHi - lineLo) * t) / 4)}</text>}
              </g>
            );
          })}
          {labels.map((lb, i) => {
            const gx = ML + i * gw + (gw - bw * bars.length) / 2;
            return (
              <g key={`${lb}-${i}`}>
                {bars.map((s, si) => {
                  const v = s.values[i] ?? 0;
                  const y = yBar(v);
                  return v > 0 ? (
                    <rect key={s.name} x={gx + si * bw} y={y} width={Math.max(bw - 1, 1)} height={MT + ih - y} rx={2} fill={TONE_VAR[s.tone]}>
                      <title>{`${lb} · ${s.name}: ${fmt(v, s.format ?? barFormat)}`}</title>
                    </rect>
                  ) : null;
                })}
                {i % step === 0 && <text x={ML + i * gw + gw / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--text-secondary)">{lb}</text>}
              </g>
            );
          })}
          {line && n > 0 && (
            <g>
              <polyline fill="none" stroke={TONE_VAR[line.tone]} strokeWidth="2" strokeLinejoin="round" points={lineVals.map((v, i) => `${ML + i * gw + gw / 2},${yLine(v)}`).join(" ")} />
              {lineVals.map((v, i) => (
                <circle key={i} cx={ML + i * gw + gw / 2} cy={yLine(v)} r={3} fill="var(--bg-surface)" stroke={TONE_VAR[line.tone]} strokeWidth="2">
                  <title>{`${labels[i]} · ${line.name}: ${fmt(v, line.format ?? "count")}`}</title>
                </circle>
              ))}
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

/** Donut + chú giải bên cạnh (nhãn, %, giá trị). Lát có tone riêng dùng token tone, còn lại xoay vòng palette. */
export function DonutChart({ slices, centerLabel, centerValue, format }: { slices: Slice[]; centerLabel: string; centerValue: number; format: DashFormat }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  let acc = 0;
  const colored = slices.map((s, i) => ({ ...s, color: s.tone ? TONE_VAR[s.tone] : SLICE_VARS[i % SLICE_VARS.length]!, pct: total > 0 ? (s.value / total) * 100 : 0 }));
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative h-36 w-36 shrink-0">
        <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90" role="img" aria-label={`Cơ cấu: ${slices.map((s) => s.label).join(", ")}`}>
          <circle cx="21" cy="21" r="15.9155" fill="none" stroke="var(--bg-hover)" strokeWidth="6" />
          {colored.map((s) => {
            const dash = (s.pct / 100) * 100;
            const el = (
              <circle key={s.label} cx="21" cy="21" r="15.9155" fill="none" stroke={s.color} strokeWidth="6" strokeDasharray={`${dash} ${100 - dash}`} strokeDashoffset={-acc}>
                <title>{`${s.label}: ${fmt(s.value, format)} (${s.pct.toFixed(1)}%)`}</title>
              </circle>
            );
            acc += dash;
            return el;
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="tabular text-sm font-bold leading-tight">{format === "currency" ? compact(centerValue) : fmt(centerValue, format)}</span>
          <span className="text-[11px] text-fg-secondary">{centerLabel}</span>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-1.5 text-sm">
        {colored.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate" title={s.label}>{s.label}</span>
            <span className="tabular shrink-0 font-semibold">{s.pct.toFixed(1).replace(".", ",")}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Danh sách xếp hạng: số thứ tự, tên, thanh tỷ lệ so với phần tử lớn nhất, giá trị. */
export function RankBars({ items, format }: { items: RankItem[]; format: DashFormat }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const BARS = ["var(--accent-500)", "var(--success)", "var(--warning)", "var(--tertiary)", "var(--info)"];
  return (
    <ol className="space-y-3">
      {items.map((it, i) => {
        const name = it.href ? <Link href={it.href} className="font-medium hover:text-accent">{it.label}</Link> : <span className="font-medium">{it.label}</span>;
        return (
          <li key={`${it.label}-${i}`} className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 sm:grid-cols-[1.75rem_minmax(0,10rem)_minmax(0,1fr)_auto]">
            <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-hover text-xs font-bold tabular">{i + 1}</span>
            <span className="min-w-0 truncate text-sm">{name}{it.sub && <span className="block truncate text-xs text-fg-secondary">{it.sub}</span>}</span>
            <span aria-hidden className="col-span-2 h-2 rounded-full bg-hover sm:col-span-1">
              <span className="block h-2 rounded-full" style={{ width: `${Math.max((it.value / max) * 100, 2)}%`, background: BARS[i % BARS.length] }} />
            </span>
            <span className="tabular col-span-2 text-right text-sm font-semibold sm:col-span-1">{fmt(it.value, format)}</span>
          </li>
        );
      })}
    </ol>
  );
}
