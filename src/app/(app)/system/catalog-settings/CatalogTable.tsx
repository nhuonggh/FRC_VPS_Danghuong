"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, DataTable, type Column } from "@/components/ui";
import type { CatalogSection } from "@/config/catalog-sections";
import { apiFetch } from "@/lib/api-fetch";
import { buildListHref, type ListParams } from "@/lib/query-params";
import { toastApiError } from "@/lib/api-error-toast";
import { confirm } from "@/lib/confirm-store";
import { toast } from "@/lib/toast";
import type { CatalogRow } from "@/server/catalog/adapters";

/** Không nhận hàm từ server component (RSC không truyền được function sang client): tự dựng link sắp xếp từ `params`. */
export function CatalogTable({ section, rows, params, basePath }: { section: CatalogSection; rows: CatalogRow[]; params: ListParams; basePath: string }) {
  const router = useRouter();
  const columns: Column<CatalogRow>[] = [
    { key: section.titleField, label: section.fields.find((f) => f.name === section.titleField)?.label ?? "Tên", primaryOnMobile: true, sortable: true, render: (r) => String(r[section.titleField] ?? "") },
    ...section.fields.filter((f) => f.inTable && f.name !== section.titleField).map((f): Column<CatalogRow> => ({ key: f.name, label: f.label, render: (r) => f.type === "checkbox" ? (r[f.name] ? "Có" : "Không") : f.type === "select" ? (f.options?.find((x) => x.value === r[f.name])?.label ?? "—") : String(r[f.name] ?? "") })),
    { key: "isActive", label: "Trạng thái", sortable: true, render: (r) => <Badge tone={r.isActive ? "success" : "neutral"}>{r.isActive ? "Đang dùng" : "Đã tắt"}</Badge> },
  ];
  async function toggle(row: CatalogRow) { try { await apiFetch(`/api/catalog/${section.key}/${row.id}/toggle`, { method: "POST", json: { active: !row.isActive } }); toast.success(row.isActive ? "Đã tắt danh mục." : "Đã bật danh mục."); router.refresh(); } catch (e) { toastApiError(e); } }
  async function remove(row: CatalogRow) { if (!(await confirm({ title: `Xóa ${section.singular}?`, description: "Thao tác này không thể hoàn tác.", confirmLabel: "Xóa", danger: true }))) return; try { await apiFetch(`/api/catalog/${section.key}/${row.id}`, { method: "DELETE" }); toast.success("Đã xóa danh mục."); router.refresh(); } catch (e) { toastApiError(e); } }
  return <DataTable id={`catalog-${section.key}`} columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `/system/catalog-settings/${section.key}/${r.id}`} sort={params.sort} buildSortHref={(sort) => buildListHref(basePath, params, { sort })} actionsVariant="kebab" rowActions={(r) => [
    { key: "toggle", label: r.isActive ? "Tắt" : "Bật", icon: "power", onClick: () => void toggle(r) },
    { key: "edit", label: "Sửa", icon: "pencil", href: `/system/catalog-settings/${section.key}/${r.id}?edit=basic` },
    { key: "delete", label: "Xóa", icon: "trash", danger: true, onClick: () => void remove(r) },
  ]} />;
}

export function NewCatalogButton({ section }: { section: CatalogSection }) { return <Link href={`/system/catalog-settings/${section.key}/new`} className="flex h-11 items-center gap-2 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent md:h-10"><Plus size={16} aria-hidden /> Thêm {section.singular}</Link>; }
