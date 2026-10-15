"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FileText, ListChecks } from "lucide-react";
import { FormCard, FormGrid, igArea, igInput, InlineField, inputClass, NewPage } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatQty } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { TripOptionsDTO, TripOrderOptionDTO } from "@/server/trips/queries";

/** Xếp chuyến (38): ngày, tuyến, xe + lái + phụ và danh sách đơn (đơn còn hàng phải giao, chưa nằm chuyến nào đang chạy) theo thứ tự giao. */
export function TripForm({ today, options, initialSearch = "" }: { today: string; options: TripOptionsDTO; initialSearch?: string }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const [date, setDate] = useState(today);
  const [routeId, setRouteId] = useState<number | "">("");
  const [vehicleId, setVehicleId] = useState<number | "">(options.vehicles[0]?.id ?? "");
  const [driverId, setDriverId] = useState<number | "">(options.drivers[0]?.id ?? "");
  const [assistantId, setAssistantId] = useState<number | "">("");
  const [note, setNote] = useState("");
  const [q, setQ] = useState(initialSearch);
  const [found, setFound] = useState<TripOrderOptionDTO[]>([]);
  const [picked, setPicked] = useState<TripOrderOptionDTO[]>([]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => { apiFetch<TripOrderOptionDTO[]>(`/api/trips/orders?q=${encodeURIComponent(q)}`).then((r) => { if (!cancelled) setFound(r); }).catch(() => { if (!cancelled) setFound([]); }); }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const pickedIds = new Set(picked.map((o) => o.id));
  const move = (i: number, d: -1 | 1) => setPicked((p) => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });

  async function submit() {
    if (vehicleId === "") throw new Error("Chọn xe.");
    if (driverId === "") throw new Error("Chọn lái xe.");
    if (picked.length === 0) throw new Error("Chọn ít nhất một đơn.");
    const res = await apiFetch<{ id: number }>("/api/trips", { method: "POST", json: { date, routeId: routeId === "" ? null : routeId, vehicleId, driverId, assistantId: assistantId === "" ? null : assistantId, note, orderIds: picked.map((o) => o.id) }, idempotencyKey: idem.key });
    router.replace(`/delivery/trips/${res.id}`);
  }
  const sel = (id: string, label: string, value: number | "", set: (v: number | "") => void, list: { id: number; name: string }[], opts: { required?: boolean; empty?: string } = {}) => (
    <InlineField id={id} label={label} required={opts.required}>
      <select id={id} value={value} onChange={(e) => set(e.target.value ? Number(e.target.value) : "")} className={`${igInput} cursor-pointer`}>
        {opts.empty !== undefined && <option value="">{opts.empty}</option>}
        {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
    </InlineField>
  );
  return (
    <NewPage wide bare backHref="/delivery/trips" backLabel="Quay lại danh sách chuyến" title="Xếp chuyến giao" submitLabel="Tạo chuyến" isDirty={() => picked.length > 0 || Boolean(note)} onSubmit={submit}>
      <FormCard icon={FileText} title="Thông tin chuyến">
        <FormGrid>
          <InlineField id="date" label="Ngày chuyến" required><input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={igInput} /></InlineField>
          {sel("route", "Tuyến", routeId, setRouteId, options.routes, { empty: "Không chọn" })}
          {sel("vehicle", "Xe", vehicleId, setVehicleId, options.vehicles, { required: true })}
          {sel("driver", "Lái xe", driverId, setDriverId, options.drivers, { required: true })}
          {sel("assistant", "Phụ xe", assistantId, setAssistantId, options.assistants, { empty: "Không có" })}
          <InlineField id="note" label="Ghi chú" multiline className="md:col-span-2 xl:col-span-3"><textarea id="note" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={igArea} /></InlineField>
        </FormGrid>
      </FormCard>
      <FormCard icon={ListChecks} title="Đơn hàng trên chuyến">
        {(options.vehicles.length === 0 || options.drivers.length === 0) && <p role="status" className="mb-3 rounded-sm border border-warning bg-warning-soft p-3 text-sm">Chưa có xe hoặc lái xe — tạo ở Hệ thống → Cài đặt danh mục.</p>}
        <section className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Đơn cần giao</h2>
            <p className="text-xs text-fg-secondary">Chỉ hiện phần còn được giao: số đặt − đã giao − đã trả kho khi chưa giao. Ghi nhận hướng xử lý không loại đơn khỏi danh sách này.</p>
            <input aria-label="Tìm đơn" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã đơn, tên khách…" className={inputClass()} />
            <ul className="max-h-80 divide-y divide-border overflow-auto rounded-sm border border-border text-sm">
              {found.filter((o) => !pickedIds.has(o.id)).map((o) => (
                <li key={o.id} className="flex items-start justify-between gap-2 p-2">
                  <span className="min-w-0"><strong>{o.code}</strong> · {o.partnerName}<span className="block text-xs text-fg-muted">{o.address ?? "Chưa có địa chỉ"} · còn {formatQty(o.remainingQty)}{o.expectedDate ? ` · hẹn ${o.expectedDate}` : ""}</span></span>
                  <button type="button" onClick={() => setPicked((p) => [...p, o])} aria-label={`Thêm ${o.code}`} className="h-9 shrink-0 rounded-sm border border-border px-3 text-sm hover:bg-hover">Thêm</button>
                </li>
              ))}
              {found.filter((o) => !pickedIds.has(o.id)).length === 0 && <li className="p-3 text-fg-muted">Không có đơn phù hợp</li>}
            </ul>
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-semibold">Thứ tự giao ({picked.length})</h2>
            <ol className="divide-y divide-border rounded-sm border border-border text-sm">
              {picked.map((o, i) => (
                <li key={o.id} className="flex items-center justify-between gap-2 p-2">
                  <span className="min-w-0"><span className="mr-2 text-fg-muted">{i + 1}.</span><strong>{o.code}</strong> · {o.partnerName}<span className="block text-xs text-fg-muted">{o.address}</span></span>
                  <span className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Lên ${o.code}`} className="grid h-9 w-9 place-items-center rounded-sm border border-border hover:bg-hover disabled:opacity-40"><ArrowUp size={14} aria-hidden /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === picked.length - 1} aria-label={`Xuống ${o.code}`} className="grid h-9 w-9 place-items-center rounded-sm border border-border hover:bg-hover disabled:opacity-40"><ArrowDown size={14} aria-hidden /></button>
                    <button type="button" onClick={() => setPicked((p) => p.filter((x) => x.id !== o.id))} aria-label={`Bỏ ${o.code}`} className="grid h-9 w-9 place-items-center rounded-sm border border-danger text-danger hover:bg-danger-soft"><X size={14} aria-hidden /></button>
                  </span>
                </li>
              ))}
              {picked.length === 0 && <li className="p-3 text-fg-muted">Chưa chọn đơn nào</li>}
            </ol>
          </div>
        </section>
      </FormCard>
    </NewPage>
  );
}
