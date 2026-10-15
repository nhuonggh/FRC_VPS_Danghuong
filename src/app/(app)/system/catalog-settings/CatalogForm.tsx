"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormGrid, igInput, InlineField, NewPage } from "@/components/ui";
import type { CatalogSection } from "@/config/catalog-sections";
import { ApiError, apiFetch } from "@/lib/api-fetch";
import type { CatalogRow } from "@/server/catalog/adapters";

type Values = Record<string, string | boolean>;
const defaults = (section: CatalogSection, row?: CatalogRow): Values => Object.fromEntries(section.fields.map((f) => [f.name, f.type === "checkbox" ? Boolean(row?.[f.name]) : f.type === "number" ? String(row?.[f.name] ?? "").replace(".", ",") : String(row?.[f.name] ?? (!row && f.type === "select" ? f.defaultValue : undefined) ?? "")]));

function Fields({ section, values, setValues, errors }: { section: CatalogSection; values: Values; setValues: (v: Values) => void; errors: Record<string, string> }) {
  return <FormGrid cols={2}>{section.fields.map((field) => {
    const id = `cf-${field.name}`;
    if (field.type === "checkbox") {
      return <label key={field.name} htmlFor={id} className="flex min-h-11 items-center gap-3 md:col-span-2"><input id={id} type="checkbox" checked={Boolean(values[field.name])} onChange={(e) => setValues({ ...values, [field.name]: e.target.checked })} className="h-5 w-5 accent-[var(--accent-500)]" /><span className="text-sm font-medium">{field.label}</span></label>;
    }
    return <InlineField key={field.name} id={id} label={field.label} required={field.required} error={errors[field.name]} labelClass="sm:min-w-40">
      {field.type === "select"
        ? <select id={id} value={String(values[field.name])} onChange={(e) => setValues({ ...values, [field.name]: e.target.value })} className={`${igInput} cursor-pointer`}><option value="">Chọn {field.label.toLowerCase()}</option>{field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        : <input id={id} value={String(values[field.name])} maxLength={field.maxLength} onChange={(e) => setValues({ ...values, [field.name]: e.target.value })} aria-invalid={!!errors[field.name]} className={igInput} />}
    </InlineField>;
  })}</FormGrid>;
}

export function CatalogForm({ section, row }: { section: CatalogSection; row?: CatalogRow }) {
  const router = useRouter(); const initial = defaults(section, row); const [values, setValues] = useState(initial); const [errors, setErrors] = useState<Record<string, string>>({});
  const editing = !!row; const backHref = editing ? `/system/catalog-settings/${section.key}/${row.id}` : `/system/catalog-settings?section=${section.key}`;
  async function save() { try { setErrors({}); if (editing) await apiFetch(`/api/catalog/${section.key}/${row.id}`, { method: "PATCH", json: values }); else { const result = await apiFetch<{ id: number }>(`/api/catalog/${section.key}`, { method: "POST", json: values, idempotencyKey: crypto.randomUUID() }); router.push(`/system/catalog-settings/${section.key}/${result.id}`); return; } router.refresh(); } catch (e) { if (e instanceof ApiError && e.fields) setErrors(e.fields); throw e; } }
  return <NewPage backHref={backHref} backLabel="Quay lại danh mục" title={editing ? `Sửa ${section.singular}` : `Thêm ${section.singular}`} submitLabel={editing ? "Lưu thay đổi" : "Tạo"} isDirty={() => JSON.stringify(values) !== JSON.stringify(initial)} onSubmit={save}><Fields section={section} values={values} setValues={setValues} errors={errors} /></NewPage>;
}
