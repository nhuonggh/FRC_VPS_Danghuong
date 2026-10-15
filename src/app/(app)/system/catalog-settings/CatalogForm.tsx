"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NewPage } from "@/components/ui";
import type { CatalogSection } from "@/config/catalog-sections";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import type { CatalogRow } from "@/server/catalog/adapters";

type Values = Record<string, string | boolean>;
const defaults = (section: CatalogSection, row?: CatalogRow): Values => Object.fromEntries(section.fields.map((f) => [f.name, f.type === "checkbox" ? Boolean(row?.[f.name]) : String(row?.[f.name] ?? "")]));

function Fields({ section, values, setValues, errors }: { section: CatalogSection; values: Values; setValues: (v: Values) => void; errors: Record<string, string> }) {
  return <div className="grid gap-4 sm:grid-cols-2">{section.fields.map((field) => <label key={field.name} className={field.type === "checkbox" ? "flex min-h-11 items-center gap-3 sm:col-span-2" : "grid gap-1.5"}>
    {field.type === "checkbox" ? <><input type="checkbox" checked={Boolean(values[field.name])} onChange={(e) => setValues({ ...values, [field.name]: e.target.checked })} className="h-5 w-5 accent-[var(--accent-500)]" /><span className="text-sm font-medium">{field.label}</span></> : <><span className="text-sm font-medium">{field.label}{field.required && <span className="text-danger"> *</span>}</span>{field.type === "select" ? <select value={String(values[field.name])} onChange={(e) => setValues({ ...values, [field.name]: e.target.value })} className="h-11 rounded-sm border border-border bg-canvas px-3 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft md:h-10"><option value="">Chọn {field.label.toLowerCase()}</option>{field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input value={String(values[field.name])} maxLength={field.maxLength} onChange={(e) => setValues({ ...values, [field.name]: e.target.value })} className="h-11 rounded-sm border border-border bg-canvas px-3 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft md:h-10" />}{errors[field.name] && <span className="text-xs text-danger">{errors[field.name]}</span>}</>}
  </label>)}</div>;
}

export function CatalogForm({ section, row }: { section: CatalogSection; row?: CatalogRow }) {
  const router = useRouter(); const initial = defaults(section, row); const [values, setValues] = useState(initial); const [errors, setErrors] = useState<Record<string, string>>({});
  const editing = !!row; const backHref = editing ? `/system/catalog-settings/${section.key}/${row.id}` : `/system/catalog-settings?section=${section.key}`;
  async function save() { try { setErrors({}); if (editing) await apiFetch(`/api/catalog/${section.key}/${row.id}`, { method: "PATCH", json: values }); else { const result = await apiFetch<{ id: number }>(`/api/catalog/${section.key}`, { method: "POST", json: values, idempotencyKey: crypto.randomUUID() }); router.push(`/system/catalog-settings/${section.key}/${result.id}`); return; } router.refresh(); } catch (e) { if (e instanceof ApiError && e.fields) setErrors(e.fields); throw e; } }
  return <NewPage backHref={backHref} backLabel="Quay lại danh mục" title={editing ? `Sửa ${section.singular}` : `Thêm ${section.singular}`} submitLabel={editing ? "Lưu thay đổi" : "Tạo"} isDirty={() => JSON.stringify(values) !== JSON.stringify(initial)} onSubmit={save}><Fields section={section} values={values} setValues={setValues} errors={errors} /></NewPage>;
}
