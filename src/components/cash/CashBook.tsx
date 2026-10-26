"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, EmptyState, ReasonDialog, InlineField, igInput, igArea, NumberInput } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { CashBookDTO } from "@/server/cash/queries";
import { REVIEW_LABEL } from "@/server/cash/labels";
import { buildListHref, type ListParams } from "@/lib/query-params";
import { QuickTimeFilter } from "@/components/ui/QuickTimeFilter";
import { PaginationFooter } from "@/components/ui/PaginationFooter";

const TONE = { PENDING_REVIEW: "warning", REVIEWED: "success", RETURNED: "danger" } as const;

/** Sổ quỹ tiền mặt (60) / sổ tiền gửi ngân hàng (61): số dư vận hành = đã kiểm tra + chờ kiểm tra, chi tiết có số dư chạy, chốt quỹ. */
export function CashBook({ book, type, base, canClose, canReopen, canHandOver = false, canReview = false, nowIso, params }: { book: CashBookDTO; type: "CASH" | "BANK"; base: string; canClose: boolean; canReopen: boolean; canHandOver?: boolean; canReview?: boolean; nowIso: string; params?: ListParams }) {
  const router = useRouter();
  const s = book.selected;
  const [closing, setClosing] = useState(false);
  const [voiding, setVoiding] = useState<number | null>(null);
  const idem = useIdempotencyKey();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const pendingRows = s ? book.entries.filter((e) => canReview && e.reviewStatus === "PENDING_REVIEW" && (e.docType === "RECEIPT" || e.docType === "PAYMENT")) : [];
  const reviewOne = (e: { docType: string; docId: number }) => apiFetch(`/api/vouchers/${e.docType === "RECEIPT" ? "receipts" : "payments"}/${e.docId}/review`, { method: "POST", idempotencyKey: `${idem.key}-r${e.docType}${e.docId}` });
  async function review(rows: typeof pendingRows, label: string) {
    if (reviewing) return;
    setReviewError(null); setReviewing(label);
    try { for (const e of rows) await reviewOne(e); router.refresh(); }
    catch (err) { setReviewError(err instanceof Error ? err.message : "Không xác nhận được."); router.refresh(); }
    finally { setReviewing(null); }
  }
  async function reviewAll() {
    const ok = await confirm({ title: `Xác nhận ${pendingRows.length} phiếu đang chờ?`, description: "Chỉ các phiếu chờ kiểm tra trong trang này. Phiếu đã kiểm tra bị khoá sửa/hủy trực tiếp; muốn đổi phải yêu cầu điều chỉnh.", confirmLabel: "Xác nhận tất cả" });
    if (ok) await review(pendingRows, "all");
  }
  const title = type === "CASH" ? "Sổ quỹ tiền mặt" : "Sổ tiền gửi ngân hàng";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {s && <a href={`/api/cash/book/export?type=${type}&account=${s.id}`} className="flex h-11 items-center rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover md:h-10">{params?.timePreset ? "Xuất sổ cả kỳ" : "Xuất Excel"}</a>}
          {s && canClose && <button type="button" onClick={() => setClosing(true)} className="h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10">Chốt quỹ</button>}
        </div>
      </div>
      {book.accounts.length === 0 ? <EmptyState kind="empty" title={type === "CASH" ? "Chưa có quỹ tiền mặt" : "Chưa có tài khoản ngân hàng"} description="Tạo ở Hệ thống → Cài đặt danh mục." /> : (
        <>
          <nav aria-label="Chọn quỹ" className="flex flex-wrap gap-2">
            {book.accounts.map((a) => (
              <Link key={a.id} href={params ? buildListHref(`${base}?account=${a.id}`, params, { page: 1 }) : `${base}?account=${a.id}`} aria-current={a.id === s?.id ? "true" : undefined} className={`rounded-sm border px-3 py-2 text-sm ${a.id === s?.id ? "border-accent bg-accent-soft" : "border-border hover:bg-hover"}`}>
                <strong>{a.name}</strong>{a.bankNo ? <span className="text-fg-muted"> · {a.bankNo}</span> : null}<span className="block tabular text-xs text-fg-secondary">{formatCurrency(a.balance)}</span>
              </Link>
            ))}
          </nav>
          {s && params && <div className="space-y-2"><QuickTimeFilter basePath={`${base}?account=${s.id}`} params={params} /><p className="text-xs text-fg-secondary">Phát sinh trong kỳ {book.periodName}, theo khoảng ngày đã chọn. Các số dư phía dưới là số hiện tại của kỳ.</p></div>}
          {s && (
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Số dư vận hành" value={s.balance} hint={`Đầu kỳ ${formatCurrency(s.opening)} + thu ${formatCurrency(s.in)} − chi ${formatCurrency(s.out)}`} />
              <Stat label="Đã kiểm tra" value={s.reviewed} tone="success" hint="Đầu kỳ + phiếu thủ quỹ đã kiểm" />
              <Stat label="Chờ kiểm tra" value={s.pending} tone="warning" hint="Phiếu chưa kiểm hoặc bị trả lại" />
            </div>
          )}
          {s && (
            <div className="overflow-x-auto rounded-md border border-border bg-surface">
              {book.entries.length === 0 ? <EmptyState kind="empty" title="Chưa có phát sinh" /> : (
                <table className="w-full min-w-[1040px] text-sm">
                  <thead><tr className="bg-hover text-left text-xs font-semibold text-fg-secondary"><th className="px-3 py-2">Ngày</th><th className="px-3 py-2">Chứng từ</th><th className="px-3 py-2">Nội dung thu/chi</th><th className="px-3 py-2">Người nộp/nhận</th><th className="px-3 py-2"><span className="flex items-center gap-2">Kiểm tra{pendingRows.length > 1 && <button type="button" disabled={!!reviewing} onClick={reviewAll} className="h-7 rounded-sm border border-accent px-2 text-xs font-medium text-accent hover:bg-accent-soft disabled:opacity-50">Xác nhận tất cả ({pendingRows.length})</button>}</span></th><th className="px-3 py-2">Người kiểm tra</th><th className="px-3 py-2 text-right">Thu</th><th className="px-3 py-2 text-right">Chi</th><th className="px-3 py-2 text-right">Số dư</th></tr></thead>
                  <tbody>
                    {book.entries.map((e) => (
                      <tr key={e.id} className="border-t border-border">
                        <td className="px-3 py-2 whitespace-nowrap">{formatDate(e.at)}</td>
                        <td className="px-3 py-2">{e.docLabel} {e.docHref ? <Link href={e.docHref} className="font-mono text-xs text-accent hover:underline">{e.docCode}</Link> : e.docCode}</td>
                        <td className="max-w-[260px] px-3 py-2 text-fg-secondary">{e.content ?? ""}</td>
                        <td className="px-3 py-2">{e.counterparty ?? ""}</td>
                        <td className="px-3 py-2"><span className="flex items-center gap-2">{e.reviewStatus && <Badge tone={TONE[e.reviewStatus]}>{REVIEW_LABEL[e.reviewStatus]}</Badge>}{canReview && e.reviewStatus === "PENDING_REVIEW" && (e.docType === "RECEIPT" || e.docType === "PAYMENT") && <button type="button" disabled={!!reviewing} onClick={() => review([e], `${e.docType}${e.docId}`)} aria-label={`Xác nhận đã kiểm tra ${e.docCode ?? "phiếu"}`} className="h-7 rounded-sm bg-accent px-2 text-xs font-medium text-fg-on-accent hover:bg-accent-600 disabled:opacity-50">{reviewing === `${e.docType}${e.docId}` || reviewing === "all" ? "Đang lưu…" : "Xác nhận"}</button>}</span></td>
                        <td className="px-3 py-2 whitespace-nowrap">{e.reviewerName ?? ""}</td>
                        <td className="px-3 py-2 text-right tabular">{Number(e.amountIn) ? formatCurrency(e.amountIn) : ""}</td>
                        <td className="px-3 py-2 text-right tabular">{Number(e.amountOut) ? formatCurrency(e.amountOut) : ""}</td>
                        <td className="px-3 py-2 text-right tabular">{formatCurrency(e.running)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {params ? <PaginationFooter total={book.total} page={params.page} pageSize={params.pageSize} buildHref={(patch) => buildListHref(`${base}?account=${s.id}`, params, patch)} /> : book.total > book.entries.length && <p className="border-t border-border p-2 text-xs text-fg-muted">Hiển thị {book.entries.length}/{book.total} dòng mới nhất — xuất Excel để xem đủ.</p>}
            </div>
          )}
          {s && book.closes.length > 0 && (
            <section className="rounded-md border border-border bg-surface p-4">
              <h2 className="mb-2 text-sm font-semibold">Các lần chốt quỹ (kỳ {book.periodName})</h2>
              <ul className="divide-y divide-border text-sm">
                {book.closes.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className={c.voided ? "text-fg-muted line-through" : ""}>{formatDateTime(c.closeAt)} · sổ {formatCurrency(c.expected)} · kiểm đếm {formatCurrency(c.actual)} · {Number(c.diff) === 0 ? "khớp" : `chênh ${formatCurrency(c.diff)}`}{c.reason ? ` (${c.reason})` : ""}</span>
                    <span className="flex items-center gap-2 text-fg-muted">{c.createdByName}{c.voided ? <Badge tone="neutral">Đã hủy</Badge> : canReopen && <button type="button" onClick={() => setVoiding(c.id)} className="h-8 rounded-sm border border-danger px-2 text-xs text-danger hover:bg-danger-soft">Hủy chốt</button>}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {s && <CloseDialog canHandOver={canHandOver && type === "CASH"} open={closing} onClose={() => setClosing(false)} accountId={s.id} accountName={s.name} nowIso={nowIso} idemKey={idem.key} onDone={() => { idem.reset(); router.refresh(); }} />}
      <ReasonDialog open={voiding !== null} onClose={() => setVoiding(null)} title="Hủy lần chốt quỹ?" description="Lần chốt được đánh dấu vô hiệu (vẫn giữ để truy vết). Sổ quỹ không đổi." confirmLabel="Hủy chốt"
        onConfirm={async (reason) => { await apiFetch(`/api/cash/closes/${voiding}`, { method: "DELETE", json: { reason }, idempotencyKey: `${idem.key}-v${voiding}` }); router.refresh(); }} />
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "success" | "warning" }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <span className="text-xs font-semibold uppercase tracking-[0.04em] text-fg-secondary">{label}</span>
      <span className={`tabular block text-2xl font-bold ${tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : ""}`}>{formatCurrency(value)}</span>
      {hint && <span className="text-xs text-fg-muted">{hint}</span>}
    </div>
  );
}

function CloseDialog({ canHandOver, open, onClose, accountId, accountName, nowIso, idemKey, onDone }: { canHandOver: boolean; open: boolean; onClose: () => void; accountId: number; accountName: string; nowIso: string; idemKey: string; onDone: () => void }) {
  const [at, setAt] = useState(nowIso.slice(0, 16)); const [actual, setActual] = useState(""); const [reason, setReason] = useState(""); const [handOver, setHandOver] = useState(false);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  // Mỗi lần mở hộp thoại lấy giờ hiện tại (giờ Việt Nam) — không dùng giờ lúc trang được dựng
  useEffect(() => { if (open) setAt(new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 16)); }, [open]);
  async function submit() {
    if (busy) return;
    if (actual === "" || Number(actual) < 0) { setError("Nhập số tiền kiểm đếm."); return; }
    setBusy(true); setError(null);
    try {
      // ô datetime-local theo giờ Việt Nam (UTC+7); mốc tính ĐẾN HẾT phút đã chọn (phiếu lập trong phút đó vẫn được tính)
      await apiFetch("/api/cash/closes", { method: "POST", json: { cashAccountId: accountId, closeAt: `${at}:59.999+07:00`, actual: Number(actual), reason, handOver: canHandOver && handOver }, idempotencyKey: idemKey });
      setActual(""); setReason(""); setHandOver(false); onDone(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Không chốt được."); } finally { setBusy(false); }
  }
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-3 rounded-lg border border-border bg-raised p-5 shadow-lg">
          <Dialog.Title className="text-base font-semibold">Chốt quỹ — {accountName}</Dialog.Title>
          <Dialog.Description className="text-sm text-fg-secondary">Hệ thống tính tồn đầu + thu − chi đến mốc chốt rồi so với tiền kiểm đếm. Có chênh lệch vẫn chốt được nhưng phải ghi lý do.</Dialog.Description>
          <InlineField id="close-at" label="Mốc chốt — tính đến hết phút này (giờ Việt Nam)" required><input id="close-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={igInput} /></InlineField>
          <button type="button" onClick={() => setAt(new Date(Date.now() + 7 * 3600_000 - 86_400_000).toISOString().slice(0, 10) + "T23:59")} className="text-xs text-accent hover:underline">Chốt cho cuối ngày hôm qua (23:59)</button>
          <InlineField id="close-actual" label="Tiền kiểm đếm thực tế" required><NumberInput maxFrac={3} id="close-actual" value={actual} onValueChange={setActual} className={`${igInput} tabular`} /></InlineField>
          <InlineField id="close-reason" label="Lý do chênh lệch (nếu có)" multiline><textarea id="close-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={igArea} /></InlineField>
          {canHandOver && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={handOver} onChange={(e) => setHandOver(e.target.checked)} className="mt-1" /><span>Giám đốc nhận lại toàn bộ tiền kiểm đếm — tự lập phiếu chi “Nộp lại quỹ” bằng số kiểm đếm, ghi vào ngày của mốc chốt (quỹ về 0).</span></label>}
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="h-11 rounded-sm border border-border px-4 text-sm hover:bg-hover disabled:opacity-50 md:h-10">Đóng</button><button type="button" onClick={submit} disabled={busy} className="h-11 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-60 md:h-10">Chốt quỹ</button></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
