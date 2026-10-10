"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PrintButton } from "@/components/print/PrintButton";
import { Badge, DetailField, ReasonDialog, InlineField, igInput, igArea } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { VoucherDetailDTO } from "@/server/cash/queries";
import { REVIEW_LABEL } from "@/server/cash/labels";
import type { VoucherDoc } from "@/server/cash/schemas";

export interface VoucherPerms { canEdit: boolean; canReview: boolean; canRequestAdjust: boolean; canApprove: boolean; canPrint?: boolean }
const KIND: Record<VoucherDoc, string> = { RECEIPT: "receipts", PAYMENT: "payments" };
const TONE = { PENDING_REVIEW: "warning", REVIEWED: "success", RETURNED: "danger", CANCELLED: "neutral" } as const;
const ADJ_TONE = { REQUESTED: "warning", APPROVED: "success", REJECTED: "danger" } as const;
const ADJ_LABEL = { REQUESTED: "Chờ duyệt", APPROVED: "Đã duyệt", REJECTED: "Từ chối" } as const;

export function VoucherDetail({ v, perms, accounts }: { v: VoucherDetailDTO; perms: VoucherPerms; accounts: { id: number; name: string }[] }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"cancel" | "return" | "adjust" | null>(null);
  const base = `/api/vouchers/${KIND[v.doc]}/${v.id}`;
  const state = v.isCancelled ? "CANCELLED" : v.reviewStatus;
  const editable = !v.isCancelled && v.reviewStatus !== "REVIEWED" && v.type !== "COC" && v.type !== "TAT_TOAN_CK" && (v.type !== "CHI_PHI" || v.expenseId !== null);
  const editHref = v.type === "CHI_PHI" ? `/accounting/expenses/${v.expenseId}/edit` : `/accounting/${KIND[v.doc]}/${v.id}/edit`;
  const pendingAdj = v.adjustments.find((a) => a.status === "REQUESTED");

  async function run(fn: () => Promise<unknown>) {
    if (busy) return; setBusy(true);
    try { await fn(); idem.reset(); router.refresh(); } finally { setBusy(false); }
  }
  const review = () => run(() => apiFetch(`${base}/review`, { method: "POST", idempotencyKey: idem.key }));
  const decide = (adjustmentId: number, approve: boolean, note: string) => run(() => apiFetch(`/api/cash/adjustments/${adjustmentId}`, { method: "POST", json: { approve, note }, idempotencyKey: idem.key }));
  async function approve(adjustmentId: number) {
    const ok = await confirm({ title: "Duyệt điều chỉnh?", description: "Sổ quỹ và công nợ được ghi thêm dòng đảo + dòng mới. Không hoàn tác được (chỉ điều chỉnh tiếp).", confirmLabel: "Duyệt" });
    if (ok) await decide(adjustmentId, true, "");
  }

  return (
    <div className="space-y-4">
      <Link href={`/accounting/${KIND[v.doc]}`} className="text-sm text-accent hover:underline">← Quay lại danh sách</Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold"><span className="font-mono">{v.code}</span> · {v.typeLabel}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2"><Badge tone={TONE[state]}>{REVIEW_LABEL[state]}</Badge>{pendingAdj && <Badge tone="warning">Có yêu cầu điều chỉnh</Badge>}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {perms.canPrint && !v.isCancelled && <PrintButton docType={v.doc} docId={v.id} label={v.doc === "RECEIPT" ? "In phiếu thu" : "In phiếu chi"} />}
          {perms.canReview && !v.isCancelled && v.reviewStatus === "PENDING_REVIEW" && (
            <>
              <button type="button" disabled={busy} onClick={review} className="h-10 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-50">Kiểm tra xong</button>
              <button type="button" disabled={busy} onClick={() => setDialog("return")} className="h-10 rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover">Trả lại</button>
            </>
          )}
          {perms.canEdit && editable && <Link href={editHref} className="flex h-10 items-center rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover">{v.reviewStatus === "RETURNED" ? "Sửa & gửi lại" : "Sửa"}</Link>}
          {perms.canEdit && editable && <button type="button" disabled={busy} onClick={() => setDialog("cancel")} className="h-10 rounded-sm border border-danger px-3 text-sm font-medium text-danger hover:bg-danger-soft">Hủy phiếu</button>}
          {perms.canRequestAdjust && !v.isCancelled && v.reviewStatus === "REVIEWED" && !pendingAdj && <button type="button" disabled={busy} onClick={() => setDialog("adjust")} className="h-10 rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover">Yêu cầu điều chỉnh</button>}
        </div>
      </div>
      {v.reviewStatus === "RETURNED" && !v.isCancelled && <div role="status" className="rounded-sm border border-danger bg-danger-soft p-3 text-sm text-danger">Thủ quỹ đã trả lại phiếu{(() => { const e = [...v.events].reverse().find((x) => x.action === "RETURN"); return e?.reason ? `: ${e.reason}` : ""; })()}. Sổ quỹ và công nợ vẫn ghi theo phiếu; hãy sửa rồi gửi lại.</div>}
      {v.reviewStatus === "REVIEWED" && !v.isCancelled && <div role="status" className="rounded-sm border border-border bg-hover p-3 text-sm text-fg-secondary">Phiếu đã được thủ quỹ kiểm tra nên khoá sửa/hủy trực tiếp. Muốn thay đổi: “Yêu cầu điều chỉnh” (cần thủ quỹ duyệt).</div>}

      <section className="rounded-md border border-border bg-surface p-4">
        <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <DetailField label="Số tiền"><strong className="tabular">{formatCurrency(v.amount)}</strong></DetailField>
          <DetailField label="Ngày">{formatDate(v.at)}</DetailField>
          <DetailField label={v.doc === "RECEIPT" ? "Vào quỹ / tài khoản" : "Chi từ quỹ / tài khoản"}>{v.cashAccountName}</DetailField>
          <DetailField label="Đối tác">{v.partnerName}</DetailField>
          {v.doc === "RECEIPT" && <DetailField label="Đơn hàng">{v.orderId ? <Link href={`/sales/orders/${v.orderId}`} className="text-accent hover:underline">{v.orderCode}</Link> : null}</DetailField>}
          <DetailField label="Người lập">{v.createdByName}</DetailField>
          <DetailField label="Người kiểm tra">{v.reviewedByName ? `${v.reviewedByName} · ${formatDateTime(v.reviewedAt!)}` : null}</DetailField>
          <DetailField label="Ghi chú">{v.note}</DetailField>
        </dl>
      </section>

      {v.adjustments.length > 0 && (
        <section className="rounded-md border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold">Điều chỉnh</h2>
          <ul className="divide-y divide-border text-sm">
            {v.adjustments.map((a) => (
              <li key={a.id} className="space-y-1 py-2">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={ADJ_TONE[a.status]}>{ADJ_LABEL[a.status]}</Badge><strong>{a.kind === "VOID" ? "Hủy phiếu" : "Đổi số tiền / quỹ"}</strong>{a.kind === "AMOUNT" && <span className="tabular">{a.oldAmount ? formatCurrency(a.oldAmount) : ""} → {a.newAmount ? formatCurrency(a.newAmount) : "giữ nguyên"}{a.newCashAccountName ? ` · ${a.newCashAccountName}` : ""}</span>}</div>
                <p className="text-fg-secondary">Lý do: {a.reason} — {a.requestedByName} · {formatDateTime(a.requestedAt)}</p>
                {a.decidedAt && <p className="text-fg-secondary">{a.decidedByName} · {formatDateTime(a.decidedAt)}{a.decisionNote ? ` — ${a.decisionNote}` : ""}</p>}
                {a.status === "REQUESTED" && perms.canApprove && (
                  <div className="flex gap-2 pt-1">
                    <button type="button" disabled={busy} onClick={() => approve(a.id)} className="h-9 rounded-sm bg-accent px-3 text-sm font-medium text-fg-on-accent disabled:opacity-50">Duyệt</button>
                    <RejectButton busy={busy} onReject={(note) => decide(a.id, false, note)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-md border border-border bg-surface p-4">
        <h2 className="mb-2 text-sm font-semibold">Lịch sử</h2>
        <ul className="divide-y divide-border text-sm">
          {v.events.map((e) => (
            <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{e.actionLabel}{e.reason ? ` — ${e.reason}` : ""}</span><span className="text-fg-muted">{e.userName ?? "Hệ thống"} · {formatDateTime(e.at)}</span></li>
          ))}
        </ul>
      </section>

      <ReasonDialog open={dialog === "cancel"} onClose={() => setDialog(null)} title={`Hủy phiếu ${v.code}?`} description="Sổ quỹ và công nợ trở về như trước khi lập phiếu." confirmLabel="Hủy phiếu"
        onConfirm={async (reason) => { await apiFetch(`${base}/cancel`, { method: "POST", json: { reason } }); router.refresh(); }} />
      <ReasonDialog open={dialog === "return"} onClose={() => setDialog(null)} title={`Trả lại phiếu ${v.code}?`} description="Phiếu về trạng thái “Bị trả lại” để kế toán sửa và gửi lại. Sổ quỹ và công nợ không đổi." confirmLabel="Trả lại"
        onConfirm={async (reason) => { await apiFetch(`${base}/return`, { method: "POST", json: { reason }, idempotencyKey: idem.key }); idem.reset(); router.refresh(); }} />
      <AdjustDialog open={dialog === "adjust"} onClose={() => setDialog(null)} v={v} accounts={accounts} idemKey={idem.key} onDone={() => { idem.reset(); router.refresh(); }} />
    </div>
  );
}

function RejectButton({ busy, onReject }: { busy: boolean; onReject: (note: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" disabled={busy} onClick={() => setOpen(true)} className="h-9 rounded-sm border border-danger px-3 text-sm text-danger hover:bg-danger-soft disabled:opacity-50">Từ chối</button>
      <ReasonDialog open={open} onClose={() => setOpen(false)} title="Từ chối yêu cầu điều chỉnh?" confirmLabel="Từ chối" onConfirm={onReject} />
    </>
  );
}

function AdjustDialog({ open, onClose, v, accounts, idemKey, onDone }: { open: boolean; onClose: () => void; v: VoucherDetailDTO; accounts: { id: number; name: string }[]; idemKey: string; onDone: () => void }) {
  const [kind, setKind] = useState<"AMOUNT" | "VOID">("AMOUNT");
  const [amount, setAmount] = useState(""); const [accountId, setAccountId] = useState<number | "">(""); const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit() {
    if (busy) return;
    if (!reason.trim()) { setError("Nhập lý do."); return; }
    if (kind === "AMOUNT" && !amount && accountId === "") { setError("Nhập số tiền mới hoặc chọn quỹ mới."); return; }
    setBusy(true); setError(null);
    try {
      await apiFetch(`/api/vouchers/${v.doc === "RECEIPT" ? "receipts" : "payments"}/${v.id}/adjust`, { method: "POST", json: { kind, reason, newAmount: kind === "AMOUNT" && amount ? Number(amount) : null, newCashAccountId: kind === "AMOUNT" && accountId !== "" ? accountId : null }, idempotencyKey: idemKey });
      setAmount(""); setAccountId(""); setReason(""); onDone(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Không gửi được yêu cầu."); } finally { setBusy(false); }
  }
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-3 rounded-lg border border-border bg-raised p-5 shadow-lg">
          <Dialog.Title className="text-base font-semibold">Yêu cầu điều chỉnh {v.code}</Dialog.Title>
          <Dialog.Description className="text-sm text-fg-secondary">Thủ quỹ duyệt xong, hệ thống ghi dòng đảo + dòng mới vào sổ quỹ và công nợ (không sửa dòng đã kiểm tra).</Dialog.Description>
          <InlineField id="adj-kind" label="Nội dung"><select id="adj-kind" value={kind} onChange={(e) => setKind(e.target.value as "AMOUNT" | "VOID")} className={igInput}><option value="AMOUNT">Đổi số tiền / quỹ</option><option value="VOID">Hủy phiếu</option></select></InlineField>
          {kind === "AMOUNT" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <InlineField id="adj-amount" label={`Số tiền mới (hiện ${formatCurrency(v.amount)})`}><input id="adj-amount" type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${igInput} tabular`} /></InlineField>
              <InlineField id="adj-account" label="Quỹ mới"><select id="adj-account" value={accountId} onChange={(e) => setAccountId(e.target.value ? Number(e.target.value) : "")} className={igInput}><option value="">Giữ nguyên</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></InlineField>
            </div>
          )}
          <InlineField id="adj-reason" label="Lý do" required multiline><textarea id="adj-reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={igArea} /></InlineField>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="h-11 rounded-sm border border-border px-4 text-sm hover:bg-hover disabled:opacity-50 md:h-10">Đóng</button><button type="button" onClick={submit} disabled={busy} className="h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-60 md:h-10">Gửi yêu cầu</button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
