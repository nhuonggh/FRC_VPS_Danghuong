"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, DataTable, type Column, type RowAction } from "@/components/ui";
import { QuickEditBar } from "@/components/ui/QuickEditBar";
import { toastApiError } from "@/lib/api-error-toast";
import { apiFetch } from "@/lib/api-fetch";
import { formatQty } from "@/lib/format";
import { toast } from "@/lib/toast";
import { buildListHref, type ListParams } from "@/lib/query-params";
import type { ProductDTO } from "@/server/products/queries";
import { PRODUCT_KINDS } from "@/server/products/schemas";
const labels = new Map<string, string>(PRODUCT_KINDS.map((item) => [item.value, item.label])); const BASE = "/inventory/products";
const cell = "h-9 w-full rounded-sm border border-border bg-canvas px-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft";
type Draft = { unit: string; factor: string };
const draftOf = (item: ProductDTO): Draft => ({ unit: item.units[0]?.unit ?? "", factor: (item.units[0]?.factor ?? "").replace(".", ",") });
export function ProductTable({ rows, canManage, params }: { rows: ProductDTO[]; canManage: boolean; params: ListParams }) {
  const router = useRouter(); const [editing, setEditing] = useState(false); const [saving, setSaving] = useState(false); const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const dirtyRows = rows.filter((r) => { const d = drafts[r.id]; const o = draftOf(r); return d && (d.unit !== o.unit || d.factor !== o.factor); });
  const stop = () => { setEditing(false); setDrafts({}); };
  async function save() { setSaving(true); try { await apiFetch("/api/products/bulk-units", { method: "PATCH", json: { items: dirtyRows.map((r) => ({ id: r.id, ...drafts[r.id]! })) } }); toast.success(`Đã lưu ${dirtyRows.length} sản phẩm.`); stop(); router.refresh(); } catch (e) { toastApiError(e); } finally { setSaving(false); } }
  const setDraft = (item: ProductDTO, patch: Partial<Draft>) => setDrafts((s) => ({ ...s, [item.id]: { ...(s[item.id] ?? draftOf(item)), ...patch } }));
  const convCell = (item: ProductDTO) => { if (editing && item.units.length > 1) return <span className="text-xs text-fg-muted">Nhiều đơn vị — sửa ở chi tiết</span>; if (editing) { const d = drafts[item.id] ?? draftOf(item); return <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}><input aria-label={`Tỷ trọng ${item.code}`} inputMode="decimal" value={d.factor} onChange={(e) => setDraft(item, { factor: e.target.value })} className={`${cell} w-24 text-right`} placeholder="2,4" /><input aria-label={`Đơn vị quy đổi ${item.code}`} value={d.unit} maxLength={10} onChange={(e) => setDraft(item, { unit: e.target.value })} className={`${cell} w-20`} placeholder="kg" /></span>; } return item.units.length ? item.units.map((u) => `${formatQty(u.factor)} ${u.unit}`).join(" · ") : <span className="text-fg-muted">—</span>; };
  const columns: Column<ProductDTO>[] = [{ key: "code", label: "Mã", sortable: true, render: (item) => <span className="font-mono text-xs">{item.code}</span> }, { key: "name", label: "Tên", sortable: true, primaryOnMobile: true, render: (item) => item.name }, { key: "group", label: "Nhóm hàng", render: (item) => item.groupName ?? <span className="text-fg-muted">—</span> }, { key: "kind", label: "Loại", sortable: true, render: (item) => labels.get(item.kind) }, { key: "baseUnit", label: "Đơn vị gốc", render: (item) => item.baseUnit }, { key: "minStock", label: "Định mức tồn", align: "right", render: (item) => Number(item.minStock) > 0 ? formatQty(item.minStock) : null }, { key: "units", label: "Tỷ trọng", align: "right", render: convCell }, { key: "status", label: "Trạng thái", render: (item) => item.isActive ? <Badge tone="success">Đang bán</Badge> : <Badge>Ngừng bán</Badge> }]; const actions = (item: ProductDTO): RowAction[] => [{ key: "view", label: "Xem", icon: "eye", href: `${BASE}/${item.id}` }, ...(canManage ? [{ key: "edit", label: "Sửa", icon: "pencil" as const, href: `${BASE}/${item.id}?edit=basic` }] : [])]; return <>{canManage && <QuickEditBar editing={editing} dirty={dirtyRows.length} saving={saving} onEdit={() => setEditing(true)} onSave={() => void save()} onCancel={stop} hint="Nhập Tỷ trọng + Đơn vị quy đổi (vd 2,4 kg = 1 đơn vị gốc). Xóa cả hai ô để bỏ quy đổi." />}<DataTable id="products" columns={columns} rows={rows} rowKey={(item) => item.id} rowHref={(item) => `${BASE}/${item.id}`} rowActions={actions} sort={params.sort} buildSortHref={(sort) => buildListHref(BASE, params, { sort })} /></>; }
