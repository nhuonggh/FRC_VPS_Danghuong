"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, DetailPage, useDetailNav } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { confirm } from "@/lib/confirm-store";
import { formatDate, formatDateTime, formatQty } from "@/lib/format";
import type { BomDetailDTO, BomVersionDTO } from "@/server/bom";

function LinesTable({ lines }: { lines: BomVersionDTO["lines"] }) {
  return (
    <div className="overflow-x-auto rounded-sm border border-border">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="bg-hover text-left text-xs font-semibold text-fg-secondary">
            <th className="px-3 py-2">Nguyên vật liệu</th>
            <th className="px-3 py-2 text-right">Định mức</th>
            <th className="px-3 py-2">ĐVT</th>
            <th className="px-3 py-2">Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-border">
              <td className="px-3 py-2"><strong>{l.materialName}</strong><span className="block font-mono text-xs text-fg-muted">{l.materialCode}</span></td>
              <td className="px-3 py-2 text-right tabular">{formatQty(l.qtyPerUnit)}</td>
              <td className="px-3 py-2">{l.baseUnit}</td>
              <td className="px-3 py-2 text-fg-secondary">{l.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS = {
  ACTIVE: { label: "Hiệu lực", tone: "success" as const },
  DRAFT: { label: "Nháp", tone: "neutral" as const },
  CANCELLED: { label: "Đã huỷ", tone: "danger" as const },
};

export function BomDetail({ bom, canManage, today }: { bom: BomDetailDTO; canManage: boolean; today: string }) {
  const router = useRouter();
  const nav = useDetailNav(["current", "versions"]);
  const current = bom.versions.find((v) => v.isCurrent) ?? null;

  async function cancelVersion(v: BomVersionDTO) {
    const ok = await confirm({
      title: `Huỷ phiên bản v${v.versionNo}?`,
      description: `Phiên bản hiệu lực từ ${formatDate(v.validFrom)} chưa được dùng nên sẽ được huỷ. Dữ liệu vẫn được lưu để tra cứu.`,
      confirmLabel: "Huỷ phiên bản",
      danger: true,
    });
    if (!ok) return;
    await apiFetch(`/api/bom/versions/${v.id}/cancel`, { method: "POST" });
    router.refresh();
  }

  const currentTab = () => (
    <div className="space-y-4">
      {current ? (
        <>
          <p className="text-sm text-fg-secondary">Phiên bản v{current.versionNo} — hiệu lực từ {formatDate(current.validFrom)}.</p>
          <LinesTable lines={current.lines} />
        </>
      ) : (
        <p className="text-sm text-fg-secondary">Chưa có phiên bản nào đang hiệu lực hôm nay.</p>
      )}
    </div>
  );

  const versionsTab = () => (
    <div className="space-y-6">
      {bom.versions.map((v) => {
        const st = STATUS[v.status];
        const upcoming = v.status === "ACTIVE" && v.validFrom > today;
        return (
          <section key={v.id} aria-label={`Phiên bản ${v.versionNo}`} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">v{v.versionNo} · từ {formatDate(v.validFrom)}</h3>
              <Badge tone={st.tone}>{st.label}</Badge>
              {v.isCurrent && <Badge tone="info">Đang áp dụng</Badge>}
              {upcoming && <Badge tone="warning">Lên lịch</Badge>}
              <span className="text-xs text-fg-muted">Tạo {formatDateTime(v.createdAt)}</span>
              {canManage && upcoming && (
                <button type="button" onClick={() => cancelVersion(v)} aria-label={`Huỷ phiên bản v${v.versionNo}`}
                  className="ml-auto h-9 rounded-sm border border-danger px-3 text-sm font-medium text-danger hover:bg-danger-soft">Huỷ phiên bản</button>
              )}
            </div>
            {v.note && <p className="text-sm text-fg-secondary">{v.note}</p>}
            <LinesTable lines={v.lines} />
          </section>
        );
      })}
    </div>
  );

  return (
    <DetailPage
      backHref="/production/bom" backLabel="Quay lại định mức NVL"
      headerActions={canManage ? (
        <Link href={`/production/bom/new?from=${bom.id}`} className="flex h-10 items-center rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent">Tạo phiên bản mới</Link>
      ) : undefined}
      summary={{
        title: bom.productName, code: bom.productCode,
        badges: [current ? { label: `v${current.versionNo} hiệu lực`, tone: "success" } : { label: "Chưa hiệu lực", tone: "warning" }],
        facts: [
          { label: "Kiểu gia công", value: bom.processingType },
          { label: "Số phiên bản", value: bom.versions.length },
          { label: "Số NVL hiện hành", value: current?.lines.length ?? "—" },
        ],
      }}
      tabs={[
        { key: "current", label: "Hiện hành", render: currentTab },
        { key: "versions", label: "Phiên bản", count: bom.versions.length, render: versionsTab },
      ]}
      {...nav}
    />
  );
}
