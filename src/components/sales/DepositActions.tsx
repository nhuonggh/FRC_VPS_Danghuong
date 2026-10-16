"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRightLeft, Ban, LockKeyhole } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";

/** Chuyển cọc thành số dư khách / hủy phiếu cọc. Dùng ở danh sách cọc và tab Tiền cọc của đơn. */
export function DepositActions({ id, code, attached, reviewed, cashAccountName, iconOnly = false }: { id: number; code: string; attached: boolean; reviewed: boolean; cashAccountName: string; iconOnly?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(kind: "release" | "cancel") {
    if (busy) return;
    const ok = await confirm(kind === "release"
      ? { title: `Chuyển cọc ${code} thành số dư của khách?`, description: `Tiền vẫn ở quỹ ${cashAccountName}${reviewed ? " (đã kiểm tra)" : ""}, không đổi. Chỉ bỏ liên kết cọc với đơn (để hủy đơn được); tiền thành số dư của khách, dùng cho đơn sau.`, confirmLabel: "Chuyển thành số dư" }
      : { title: `Hủy phiếu cọc ${code}?`, description: "Dùng khi nhập nhầm. Công nợ ghi theo phiếu này sẽ được gỡ.", confirmLabel: "Hủy phiếu", danger: true });
    if (!ok) return;
    setBusy(true);
    try { await apiFetch(`/api/deposits/${id}/${kind}`, { method: "POST" }); router.refresh(); } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      {attached && <button type="button" disabled={busy} onClick={() => run("release")} aria-label={`Chuyển cọc ${code} thành số dư`} title="Chuyển thành số dư khách" className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-sm border border-border px-3 text-sm hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 md:min-h-9 md:min-w-9"><ArrowRightLeft size={16} aria-hidden />{!iconOnly && "Chuyển thành số dư"}</button>}
      {reviewed
        ? <span title="Đã vào sổ quỹ — không hủy được" className="inline-flex items-center gap-1 text-xs text-fg-secondary"><LockKeyhole size={14} aria-hidden />Đã vào sổ quỹ</span>
        : <button type="button" disabled={busy} onClick={() => run("cancel")} aria-label={`Hủy phiếu cọc ${code}`} title="Hủy phiếu cọc" className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-sm border border-danger px-3 text-sm text-danger hover:bg-danger-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 md:min-h-9 md:min-w-9"><Ban size={16} aria-hidden />{!iconOnly && "Hủy phiếu"}</button>}
    </span>
  );
}
