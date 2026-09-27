"use client";

import type { DefaultValues, FieldValues, UseFormReturn } from "react-hook-form";
import type { ZodType } from "zod";
import { DetailSection, EditActions, EditButton, useSectionForm, type TabRenderCtx } from "./DetailPage";

/** Section chi tiết chỉ cho sửa một phần tại một thời điểm, tránh ghi đè field không liên quan. */
export function EditableSection<T extends FieldValues>({ ctx, k, title, editLabel, canEdit, schema, defaults, save, view, edit }: {
  ctx: TabRenderCtx; k: string; title: string; editLabel: string; canEdit: boolean; schema: ZodType<T>; defaults: DefaultValues<T>; save: (values: T) => Promise<void>; view: React.ReactNode; edit: (form: UseFormReturn<T>) => React.ReactNode;
}) {
  const section = useSectionForm<T>(ctx, k, { schema, defaults, save });
  const editing = canEdit && section.editing;
  return <DetailSection title={title} editing={editing} action={!canEdit ? null : editing ? <EditActions saving={section.saving} onSave={section.onSave} onCancel={section.onCancel} /> : <EditButton label={editLabel} onClick={() => ctx.beginEdit(k)} />}>
    {editing ? edit(section.form) : view}
  </DetailSection>;
}
