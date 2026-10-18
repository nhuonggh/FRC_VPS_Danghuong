"use client";
import { Badge } from "@/components/ui/Badge";
import { auditActionLabel, auditEntityLabel } from "@/lib/audit-labels";


import { DetailField, DetailPage, DetailSection, useDetailNav } from "@/components/ui/DetailPage";
import { MAX_CHANGES, truncateText, type AuditDetailDto } from "@/lib/audit-format";
import { formatDateTime, formatNumber } from "@/lib/format";

const PREVIEW_CHARS = 160;

/** Ô giá trị: ngắn → hiện thẳng; dài → xem trước + "Xem đầy đủ" (mở rộng tại chỗ, tự xuống dòng, không tràn khung). */
function Value({ text }: { text: string }) {
  if (text.length <= PREVIEW_CHARS) return <>{text}</>;
  return (
    <details>
      <summary className="cursor-pointer list-none">
        <span data-preview>{truncateText(text, PREVIEW_CHARS)}</span>{" "}
        <span className="text-xs font-medium text-accent">Xem đầy đủ ({formatNumber(text.length)} ký tự)</span>
      </summary>
      <div className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-hover p-2 text-xs">{text}</div>
    </details>
  );
}

/** Chỉ xem: dòng nhật ký bất biến (append-only) — không có bút chì, không có section sửa. */
export function AuditDetail({ entry }: { entry: AuditDetailDto }) {
  const nav = useDetailNav(["info", "changes"]);
  const changes = entry.changes;
  return (
    <DetailPage
      backHref="/system/audit-log" backLabel="Quay lại nhật ký"
      summary={{
        title: auditActionLabel(entry.action), code: `#${entry.id}`, badges: [{ label: auditEntityLabel(entry.entity) }],
        facts: [{ label: "Thời gian", value: formatDateTime(entry.at) }, { label: "Người thao tác", value: entry.by }],
      }}
      tabs={[
        {
          key: "info", label: "Thông tin",
          render: () => (
            <DetailSection title="Thao tác" action={null}>
              <dl className="grid gap-x-8 gap-y-2 md:grid-cols-2">
                <DetailField label="Hành động"><Badge tone="info">{auditActionLabel(entry.action)}</Badge></DetailField>
                <DetailField label="Đối tượng"><Badge>{auditEntityLabel(entry.entity)}</Badge></DetailField>
                <DetailField label="Mã đối tượng">{entry.entityId}</DetailField>
                <DetailField label="Người thao tác"><Badge>{entry.by}</Badge></DetailField>
                <DetailField label="Thời gian">{formatDateTime(entry.at)}</DetailField>
                <DetailField label="Địa chỉ IP">{entry.ip}</DetailField>
              </dl>
            </DetailSection>
          ),
        },
        {
          key: "changes", label: "Số cũ / số mới", count: changes.length,
          render: () => (
            <DetailSection title="Thay đổi" action={null}>
              {entry.hiddenByPermission && (
                <p role="note" className="mb-3 rounded-sm border border-border bg-hover p-3 text-sm text-fg-secondary">
                  Một số trường bị ẩn theo quyền của bạn (giá vốn, lãi/lỗ, giá nhập, giá bán).
                </p>
              )}
              {entry.truncated && (
                <p role="note" className="mb-3 rounded-sm border border-warning bg-warning-soft p-3 text-sm text-warning">
                  Chỉ hiển thị {formatNumber(MAX_CHANGES)} thay đổi đầu tiên (theo tên trường); còn nhiều thay đổi khác không hiển thị.
                </p>
              )}
              {changes.length === 0 ? (
                !entry.hiddenByPermission && (
                  <p className="rounded-sm border border-dashed border-border p-6 text-center text-sm text-fg-muted">Thao tác này không ghi số liệu trước/sau.</p>
                )
              ) : (
                <div className="overflow-x-auto">
                  {/* < md: mỗi thay đổi xếp DỌC (trường / số cũ / số mới) thay vì 3 cột */}
                  <table className="w-full table-fixed text-sm max-md:block">
                    <thead className="max-md:hidden">
                      <tr className="border-b border-border text-left text-xs uppercase tracking-[0.04em] text-fg-secondary">
                        <th className="w-1/4 py-2 pr-3">Trường</th><th className="w-[37.5%] py-2 pr-3">Số cũ</th><th className="w-[37.5%] py-2">Số mới</th>
                      </tr>
                    </thead>
                    <tbody className="max-md:block">
                      {changes.map((c) => (
                        <tr key={c.path} className="border-b border-border align-top last:border-b-0 max-md:block max-md:py-2">
                          <td className="break-words py-2 pr-3 text-xs max-md:block max-md:py-0.5">{c.path || "(toàn bộ)"}</td>
                          <td className="break-words py-2 pr-3 text-danger max-md:block max-md:py-0.5 max-md:before:mr-1 max-md:before:text-fg-muted max-md:before:content-['Cũ:']"><Value text={c.before} /></td>
                          <td className="break-words py-2 text-success max-md:block max-md:py-0.5 max-md:before:mr-1 max-md:before:text-fg-muted max-md:before:content-['Mới:']"><Value text={c.after} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DetailSection>
          ),
        },
      ]}
      {...nav}
    />
  );
}
