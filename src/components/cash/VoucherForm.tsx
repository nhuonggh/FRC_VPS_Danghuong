"use client";

import { advancerFields } from "@/lib/advancer";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { UserRound, Wallet } from "lucide-react";
import { Combobox, FormCard, FormGrid, igArea, igCombo, igInput, InlineField, NewPage, type ComboOption, NumberInput } from "@/components/ui";
import { filterComboOptions } from "@/components/ui/Combobox";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import { PAYMENT_KIND_LABEL, PAYMENT_KINDS, RECEIPT_TYPE_LABEL, RECEIPT_TYPES, type VoucherDoc } from "@/server/cash/schemas";

export interface VoucherFormInitial {
  advancedBy?: ComboOption | null;
  type: string; partner: ComboOption | null; order: ComboOption | null; cashAccountId: number; amount: string; date: string; note: string;
}
const URL_KIND: Record<VoucherDoc, string> = { RECEIPT: "receipts", PAYMENT: "payments" };

/** Lập / sửa phiếu thu (57) và phiếu chi (59). Sửa: chỉ khi chưa kiểm tra; sửa xong phiếu bị trả lại tự gửi lại. */
export function VoucherForm({ doc, id, code, today, accounts, initial, people = [] }: {
  people?: ComboOption[];
  doc: VoucherDoc; id?: number; code?: string; today: string; accounts: { id: number; name: string; type: "CASH" | "BANK" }[]; initial?: VoucherFormInitial;
}) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const receipt = doc === "RECEIPT";
  const [type, setType] = useState(initial?.type ?? (receipt ? "THU_NO" : "TRA_NCC"));
  const [partner, setPartner] = useState<ComboOption | null>(initial?.partner ?? null);
  const [order, setOrder] = useState<number | "">(initial?.order ? Number(initial.order.value) : "");
  const [orders, setOrders] = useState<ComboOption[]>(initial?.order ? [initial.order] : []);
  const [accountId, setAccountId] = useState<number>(initial?.cashAccountId ?? accounts[0]?.id ?? 0);
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [date, setDate] = useState(initial?.date ?? today);
  const [note, setNote] = useState(initial?.note ?? "");
  // ASSUMPTION: người ứng tiền là tài khoản nhân viên, không phát sinh công nợ riêng.
  const [advancedBy, setAdvancedBy] = useState<ComboOption | null>(initial?.advancedBy ?? null);
  const editing = id !== undefined;

  const partnerRole = receipt ? (type === "THU_NO" ? "customer" : "any") : type === "TRA_NCC" ? "supplier" : "customer";
  const needsPartner = receipt ? type === "THU_NO" : type !== "KHAC";
  const partnerOptional = receipt && type === "KHAC";
  const showPartner = needsPartner || partnerOptional;

  useEffect(() => {
    if (!receipt || type !== "THU_NO" || !partner) { if (!editing) setOrders([]); return; }
    let cancelled = false;
    apiFetch<ComboOption[]>(`/api/cash/orders?partnerId=${partner.value}`).then((o) => { if (!cancelled) setOrders(o); }).catch(() => { if (!cancelled) setOrders([]); });
    return () => { cancelled = true; };
  }, [receipt, type, partner, editing]);

  const load = (q: string) => apiFetch<ComboOption[]>(`/api/cash/partners?role=${partnerRole}&q=${encodeURIComponent(q)}`);

  async function submit() {
    if (needsPartner && !partner) throw new Error(receipt ? "Chọn khách hàng." : type === "TRA_NCC" ? "Chọn nhà cung cấp." : "Chọn khách hàng.");
    if (!(Number(amount) > 0)) throw new Error("Nhập số tiền lớn hơn 0.");
    if (!accountId) throw new Error("Chọn quỹ/tài khoản.");
    const body = receipt
      ? { type, partnerId: partner ? Number(partner.value) : null, orderId: type === "THU_NO" && order !== "" ? order : null, cashAccountId: accountId, amount: Number(amount), date, note }
      : { kind: type, partnerId: needsPartner && partner ? Number(partner.value) : null, cashAccountId: accountId, amount: Number(amount), date, note, ...advancerFields(advancedBy) };
    const res = editing
      ? await apiFetch<{ id: number }>(`/api/vouchers/${URL_KIND[doc]}/${id}`, { method: "PATCH", json: body })
      : await apiFetch<{ id: number }>(`/api/vouchers/${URL_KIND[doc]}`, { method: "POST", json: body, idempotencyKey: idem.key });
    router.replace(`/accounting/${URL_KIND[doc]}/${res.id}`);
  }

  const types = receipt ? RECEIPT_TYPES : PAYMENT_KINDS;
  const labels: Record<string, string> = receipt ? RECEIPT_TYPE_LABEL : PAYMENT_KIND_LABEL;
  const listHref = `/accounting/${URL_KIND[doc]}`;
  return (
    <NewPage wide backHref={editing ? `${listHref}/${id}` : listHref} backLabel={editing ? "Quay lại phiếu" : "Quay lại danh sách"}
      title={editing ? `Sửa ${receipt ? "phiếu thu" : "phiếu chi"} ${code}` : receipt ? "Lập phiếu thu" : "Lập phiếu chi"} submitLabel={editing ? "Lưu thay đổi" : "Lưu phiếu"}
      isDirty={() => Boolean(amount || note || advancedBy)} onSubmit={submit}
      footerInfo={amount ? <span className="text-sm font-semibold">Số tiền: <b className="ml-1 text-lg text-accent tabular">{Number(amount).toLocaleString("vi-VN")}</b></span> : undefined}>
      <FormCard icon={UserRound} title="Thông tin phiếu">
        <FormGrid cols={2}>
          <InlineField id="type" label={receipt ? "Loại phiếu thu" : "Loại phiếu chi"} required>
            <select id="type" value={type} disabled={editing} onChange={(e) => { setType(e.target.value); setPartner(null); setOrder(""); }} className={`${igInput} cursor-pointer`}>
              {types.map((t) => <option key={t} value={t}>{labels[t]}</option>)}
            </select>
          </InlineField>
          <InlineField id="date" label="Ngày" required>
            <input id="date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className={igInput} />
          </InlineField>
          {showPartner && (
            <InlineField id="partner" label={partnerRole === "supplier" ? "Nhà cung cấp" : partnerRole === "customer" ? "Khách hàng" : "Đối tác"} required={needsPartner} className="md:col-span-2">
              <div className={igCombo}>
                <Combobox hideLabel label={partnerRole === "supplier" ? "Nhà cung cấp" : partnerRole === "customer" ? "Khách hàng" : "Đối tác (tuỳ chọn)"} value={partner} loadOptions={load} placeholder="Tìm theo mã hoặc tên…" onChange={(p) => { setPartner(p); setOrder(""); }} />
              </div>
            </InlineField>
          )}
          {receipt && type === "THU_NO" && (
            <InlineField id="order" label="Thu theo đơn" className="md:col-span-2" hint="Tuỳ chọn: chọn đơn để cập nhật trạng thái thanh toán của đơn; bỏ trống = thu nợ chung.">
              <select id="order" value={order} disabled={!partner} onChange={(e) => setOrder(e.target.value ? Number(e.target.value) : "")} className={`${igInput} cursor-pointer`}>
                <option value="">Không gắn đơn</option>
                {orders.map((o) => <option key={o.value} value={o.value}>{o.label}{o.hint ? ` · ${o.hint}` : ""}</option>)}
              </select>
            </InlineField>
          )}
        </FormGrid>
      </FormCard>
      <FormCard icon={Wallet} title="Thanh toán">
        <FormGrid cols={2}>
          <InlineField id="account" label={receipt ? "Vào quỹ / tài khoản" : "Chi từ quỹ / tài khoản"} required>
            <select id="account" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))} className={`${igInput} cursor-pointer`}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.type === "BANK" ? " (ngân hàng)" : ""}</option>)}
            </select>
          </InlineField>
          <InlineField id="amount" label="Số tiền" required>
            <NumberInput id="amount" value={amount} onValueChange={setAmount} className={`${igInput} tabular text-right`} />
          </InlineField>
          {!receipt && <InlineField id="advancedBy" label="Người ứng tiền" className="md:col-span-2">
            <div className={igCombo}>
              <Combobox hideLabel label="Người ứng tiền" value={advancedBy} onChange={setAdvancedBy}
                loadOptions={async (q) => filterComboOptions(people, q)} placeholder="Tìm và chọn người ứng tiền…" />
            </div>
          </InlineField>}
          <InlineField id="note" label="Ghi chú" multiline className="md:col-span-2">
            <textarea id="note" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={igArea} />
          </InlineField>
        </FormGrid>
        <p className="mt-3 text-sm text-fg-secondary">Phiếu được ghi vào sổ quỹ và công nợ ngay; thủ quỹ sẽ kiểm tra sau.</p>
      </FormCard>
    </NewPage>
  );
}
