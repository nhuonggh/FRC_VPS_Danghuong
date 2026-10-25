"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { toastApiError } from "@/lib/api-error-toast";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import { formatDate } from "@/lib/format";
import { buildListHref, type ListParams } from "@/lib/query-params";
import { toast } from "@/lib/toast";
import type { BomListRow } from "@/server/bom";

const BASE = "/production/bom";
const btn = "h-10 rounded-sm border border-border bg-canvas px-3 text-sm font-medium hover:bg-hover";

export function BomTable({ rows, canManage, canDelete = false, params }: { rows: BomListRow[]; canManage: boolean; canDelete?: boolean; params: ListParams }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string | number>>(new Set());
  const [pending, setPending] = useState<BomListRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [blockedMsg, setBlockedMsg] = useState<string | null>(null);

  const columns: Column<BomListRow>[] = [
    {
      key: "product", label: "Thành phẩm", primaryOnMobile: true,
      render: (b) => <><strong>{b.productName}</strong><span className="block font-mono text-xs text-fg-muted">{b.productCode}</span></>,
    },
    { key: "processingType", label: "Kiểu gia công", render: (b) => b.processingType },
    {
      key: "current", label: "Phiên bản hiện hành",
      render: (b) => b.current
        ? <>v{b.current.versionNo} · từ {formatDate(b.current.validFrom)}</>
        : <Badge tone="warning">Chưa có hiệu lực</Badge>,
    },
    { key: "lineCount", label: "Số NVL", align: "right", render: (b) => b.current?.lineCount ?? "—" },
    {
      key: "upcoming", label: "Lên lịch",
      render: (b) => b.upcomingFrom ? <Badge tone="info">Từ {formatDate(b.upcomingFrom)}</Badge> : <span className="text-fg-muted">—</span>,
    },
    { key: "versionCount", label: "Số phiên bản", align: "right", render: (b) => b.versionCount },
  ];
  const actions = (b: BomListRow): RowAction[] => [
    { key: "view", label: "Xem", icon: "eye", href: `${BASE}/${b.id}` },
    ...(canManage ? [{ key: "new-version", label: "Tạo phiên bản mới", icon: "pencil" as const, href: `${BASE}/new?from=${b.id}` }] : []),
    ...(canDelete ? [{ key: "delete", label: "Xóa định mức", icon: "trash" as const, danger: true, onClick: () => { setBlockedMsg(null); setPending([b]); } }] : []),
  ];

  const chosen = rows.filter((r) => selected.has(r.id));
  const close = () => { if (!busy) { setPending(null); setBlockedMsg(null); } };
  async function confirmDelete() {
    if (!pending) return;
    setBusy(true); setBlockedMsg(null);
    try {
      const res = await apiFetch<{ deleted: number }>("/api/bom/delete", { method: "POST", json: { ids: pending.map((b) => b.id) } });
      toast.success(`Đã xóa ${res.deleted} định mức.`);
      setPending(null); setSelected(new Set()); router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setBlockedMsg(e.message); else toastApiError(e);
    } finally { setBusy(false); }
  }

  return (
    <>
      {canDelete && chosen.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-sm border border-accent bg-accent-soft px-3 py-2 text-sm" role="region" aria-label="Thao tác hàng loạt">
          <b>Đã chọn {chosen.length} định mức</b>
          <span className="ml-auto flex flex-wrap gap-2">
            <button type="button" onClick={() => { setBlockedMsg(null); setPending(chosen); }} className={`${btn} text-danger`}>Xóa đã chọn…</button>
            <button type="button" onClick={() => setSelected(new Set())} className={btn}>Bỏ chọn</button>
          </span>
        </div>
      )}
      <DataTable
        id="boms" columns={columns} rows={rows} rowKey={(b) => b.id} rowHref={(b) => `${BASE}/${b.id}`} rowActions={actions}
        {...(canDelete ? { selection: { selected, onChange: setSelected } } : {})}
        sort={params.sort} buildSortHref={(sort) => buildListHref(BASE, params, { sort })}
      />
      <Dialog.Root open={pending !== null} onOpenChange={(o) => { if (!o) close(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-scrim bg-[var(--overlay-scrim)]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-dialog w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-raised p-5 shadow-lg">
            <Dialog.Title className="text-base font-semibold">Xóa {pending?.length ?? 0} định mức?</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-fg-secondary">
              Xóa hẳn định mức cùng mọi phiên bản và dòng nguyên vật liệu, không khôi phục được (cần dùng lại thì tạo mới). Định mức đã dùng để lập đơn bán hàng thì không xóa được.
            </Dialog.Description>
            {pending && (
              <ul className="mt-3 max-h-40 list-disc space-y-0.5 overflow-auto pl-5 text-sm">
                {pending.map((b) => <li key={b.id}><span className="font-mono text-xs">{b.productCode}</span> · {b.productName} · {b.processingType}</li>)}
              </ul>
            )}
            {blockedMsg && <p role="alert" className="mt-3 rounded-sm border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{blockedMsg}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={close} disabled={busy} className="h-11 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover disabled:opacity-50 md:h-10">Đóng</button>
              <button type="button" onClick={() => void confirmDelete()} disabled={busy} className="h-11 rounded-sm bg-danger px-4 text-sm font-medium text-fg-on-accent disabled:opacity-50 md:h-10">{busy ? "Đang xóa…" : "Xóa"}</button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
