"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";

/** Chuyển cọc thành số dư khách / hủy phiếu cọc. Dùng ở danh sách cọc và tab Tiền cọc của đơn. */
export function DepositActions({ id, code, attached }: { id: number; code: string; attached: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(kind: "release" | "cancel") {
    if (busy) return;
    const ok = await confirm(kind === "release"
      ? { title: `Chuyển cọc ${code} thành số dư của khách?`, description: "Cọc không còn gắn với đơn (để hủy đơn được). Tiền vẫn nằm ở công nợ của khách và dùng cho đơn sau.", confirmLabel: "Chuyển thành số dư" }
      : { title: `Hủy phiếu cọc ${code}?`, description: "Dùng khi nhập nhầm. Công nợ ghi theo phiếu này sẽ được gỡ.", confirmLabel: "Hủy phiếu", danger: true });
    if (!ok) return;
    setBusy(true);
    try { await apiFetch(`/api/deposits/${id}/${kind}`, { method: "POST" }); router.refresh(); } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex gap-2">
      {attached && <button type="button" disabled={busy} onClick={() => run("release")} aria-label={`Chuyển cọc ${code} thành số dư`} className="h-9 rounded-sm border border-border px-3 text-sm hover:bg-hover disabled:opacity-50">Chuyển thành số dư</button>}
      <button type="button" disabled={busy} onClick={() => run("cancel")} aria-label={`Hủy phiếu cọc ${code}`} className="h-9 rounded-sm border border-danger px-3 text-sm text-danger hover:bg-danger-soft disabled:opacity-50">Hủy phiếu</button>
    </span>
  );
}
