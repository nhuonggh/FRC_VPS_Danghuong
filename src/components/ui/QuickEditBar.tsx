"use client";
import { Pencil } from "lucide-react";

/** Thanh Edit Mode phía trên bảng: Sửa nhanh → (nhập trực tiếp trong ô) → Lưu / Hủy. */
export function QuickEditBar({ iconOnly = false, editing, dirty, saving, onEdit, onSave, onCancel, hint }: { iconOnly?: boolean; editing: boolean; dirty: number; saving: boolean; onEdit: () => void; onSave: () => void; onCancel: () => void; hint?: string }) {
  const btn = "flex h-10 items-center gap-2 rounded-sm px-4 text-sm font-medium";
  return <div className={iconOnly ? "flex flex-wrap items-center justify-end gap-2" : "mb-2 flex flex-wrap items-center justify-end gap-2"}>
    {editing ? <>
      <span className="mr-auto text-xs text-fg-muted">{dirty ? `${dirty} dòng đã sửa` : hint ?? "Nhập trực tiếp vào ô cần sửa."}</span>
      <button type="button" onClick={onCancel} disabled={saving} className={`${btn} border border-border`}>Hủy</button>
      <button type="button" onClick={onSave} disabled={saving || !dirty} className={`${btn} bg-accent text-fg-on-accent disabled:opacity-50`}>{saving ? "Đang lưu…" : "Lưu thay đổi"}</button>
    </> : <button type="button" onClick={onEdit} aria-label="Sửa nhanh" title="Sửa nhanh" className={iconOnly ? "flex h-11 w-11 items-center justify-center rounded-sm border border-border hover:bg-hover focus-visible:outline focus-visible:outline-accent md:h-10 md:w-10" : `${btn} border border-border`}><Pencil size={16} aria-hidden />{!iconOnly && "Sửa nhanh"}</button>}
  </div>;
}
