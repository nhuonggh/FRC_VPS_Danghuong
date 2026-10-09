"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, DataTable, type Column } from "@/components/ui";
import { QuickEditBar } from "@/components/ui/QuickEditBar";
import type { CatalogField, CatalogSection } from "@/config/catalog-sections";
import { apiFetch } from "@/lib/api-fetch";
import { buildListHref, type ListParams } from "@/lib/query-params";
import { toastApiError } from "@/lib/api-error-toast";
import { confirm } from "@/lib/confirm-store";
import { toast } from "@/lib/toast";
import type { CatalogRow } from "@/server/catalog/adapters";

type Values = Record<string, string | boolean>;
const CELL = "h-9 w-full min-w-24 rounded-sm border border-border bg-canvas px-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft";
/** Không nhận hàm từ server component (RSC không truyền được function sang client): tự dựng link sắp xếp từ `params`. */
export function CatalogTable({ section, rows, params, basePath }: { section: CatalogSection; rows: CatalogRow[]; params: ListParams; basePath: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false); const [saving, setSaving] = useState(false); const [drafts, setDrafts] = useState<Record<number, Values>>({});
  const original = (r: CatalogRow): Values => Object.fromEntries(section.fields.map((f) => [f.name, f.type === "checkbox" ? Boolean(r[f.name]) : f.type === "number" ? String(r[f.name] ?? "").replace(".", ",") : String(r[f.name] ?? "")]));
  const valuesOf = (r: CatalogRow): Values => drafts[r.id] ?? original(r);
  const dirtyRows = rows.filter((r) => drafts[r.id] && JSON.stringify(drafts[r.id]) !== JSON.stringify(original(r)));
  const stop = () => { setEditing(false); setDrafts({}); };
  const setValue = (r: CatalogRow, name: string, value: string | boolean) => setDrafts((s) => ({ ...s, [r.id]: { ...(s[r.id] ?? original(r)), [name]: value } }));
  async function saveAll() { setSaving(true); try { await apiFetch(`/api/catalog/${section.key}/bulk`, { method: "PATCH", json: { items: dirtyRows.map((r) => ({ id: r.id, values: drafts[r.id] })) } }); toast.success(`Đã lưu ${dirtyRows.length} dòng.`); stop(); router.refresh(); } catch (e) { toastApiError(e); } finally { setSaving(false); } }
  const editCell = (r: CatalogRow, f: CatalogField) => { const v = valuesOf(r)[f.name]; if (f.type === "checkbox") return <input type="checkbox" aria-label={f.label} checked={Boolean(v)} onChange={(e) => setValue(r, f.name, e.target.checked)} className="h-5 w-5 accent-[var(--accent-500)]" />; if (f.type === "select") return <select aria-label={f.label} value={String(v)} onChange={(e) => setValue(r, f.name, e.target.value)} className={CELL}>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>; return <input aria-label={f.label} value={String(v)} maxLength={f.maxLength} inputMode={f.type === "number" ? "decimal" : undefined} onChange={(e) => setValue(r, f.name, e.target.value)} className={`${CELL}${f.type === "number" ? " w-28 text-right" : ""}`} />; };
  const columns: Column<CatalogRow>[] = [
    { key: section.titleField, label: section.fields.find((f) => f.name === section.titleField)?.label ?? "Tên", primaryOnMobile: true, sortable: true, render: (r) => editing ? editCell(r, section.fields.find((f) => f.name === section.titleField)!) : String(r[section.titleField] ?? "") },
    ...section.fields.filter((f) => f.inTable && f.name !== section.titleField).map((f): Column<CatalogRow> => ({ key: f.name, label: f.label, align: f.type === "number" ? "right" : "left", render: (r) => editing ? editCell(r, f) : f.type === "checkbox" ? (r[f.name] ? "Có" : "Không") : f.type === "select" ? (f.options?.find((x) => x.value === r[f.name])?.label ?? "—") : f.type === "number" ? (r[f.name] == null ? "—" : String(r[f.name]).replace(".", ",")) : String(r[f.name] ?? "") })),
    { key: "isActive", label: "Trạng thái", sortable: true, render: (r) => <Badge tone={r.isActive ? "success" : "neutral"}>{r.isActive ? "Đang dùng" : "Đã tắt"}</Badge> },
  ];
  async function toggle(row: CatalogRow) { try { await apiFetch(`/api/catalog/${section.key}/${row.id}/toggle`, { method: "POST", json: { active: !row.isActive } }); toast.success(row.isActive ? "Đã tắt danh mục." : "Đã bật danh mục."); router.refresh(); } catch (e) { toastApiError(e); } }
  async function remove(row: CatalogRow) { if (!(await confirm({ title: `Xóa ${section.singular}?`, description: "Thao tác này không thể hoàn tác.", confirmLabel: "Xóa", danger: true }))) return; try { await apiFetch(`/api/catalog/${section.key}/${row.id}`, { method: "DELETE" }); toast.success("Đã xóa danh mục."); router.refresh(); } catch (e) { toastApiError(e); } }
  return <><QuickEditBar editing={editing} dirty={dirtyRows.length} saving={saving} onEdit={() => setEditing(true)} onSave={() => void saveAll()} onCancel={stop} /><DataTable id={`catalog-${section.key}`} columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/system/catalog-settings/${section.key}/${r.id}`} sort={params.sort} buildSortHref={(sort) => buildListHref(basePath, params, { sort })} actionsVariant="kebab" rowActions={(r) => [
    { key: "toggle", label: r.isActive ? "Tắt" : "Bật", icon: "power", onClick: () => void toggle(r) },
    { key: "edit", label: "Sửa", icon: "pencil", href: `/system/catalog-settings/${section.key}/${r.id}?edit=basic` },
    { key: "delete", label: "Xóa", icon: "trash", danger: true, onClick: () => void remove(r) },
  ]} /></>;
}

export function NewCatalogButton({ section }: { section: CatalogSection }) { return <Link href={`/system/catalog-settings/${section.key}/new`} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden /> Thêm {section.singular}</Link>; }
