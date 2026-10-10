"use client";

import type { UseFormReturn } from "react-hook-form";
import { Badge, DetailField, DetailPage, EditableSection, useDetailNav, type TabRenderCtx, InlineField, igInput } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { CompanyDTO, PrintTemplateDTO } from "@/server/company/queries";
import {
  companyBankSchema, companyInfoSchema, createTemplateSchema, updateTemplateSchema,
  type CreateTemplateInput, type UpdateTemplateInput,
} from "@/server/company/schemas";

const textarea = "w-full rounded-sm border border-border bg-canvas px-3 py-2 text-sm";
type TemplateForm = UseFormReturn<UpdateTemplateInput> | UseFormReturn<CreateTemplateInput>;

const emptyTemplate: CreateTemplateInput = {
  docType: "", name: "", webhookUrl: "", title: "", signerName: "", phone: "", qrImage: "", showCompanyInfo: true,
  footerNote: "", isActive: false, secretAction: "keep",
};

/** Ô nhập của một mẫu in. Secret KHÔNG BAO GIỜ được nạp lại vào form: chỉ chọn giữ / thay / xoá. */
function TemplateFields({ form, hasSecret, creating }: { form: TemplateForm; hasSecret: boolean; creating: boolean }) {
  // Hai kiểu form khác nhau ở docType; dùng chung API register/watch nên ép về một kiểu cho gọn
  const f = form as unknown as UseFormReturn<CreateTemplateInput>;
  const { register, watch, formState: { errors } } = f;
  const action = watch("secretAction");
  return (
    <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
      {creating && (
        <InlineField id="docType" label="Loại chứng từ" required error={errors.docType?.message} hint="Chữ HOA, ví dụ SALE_INVOICE">
          <input id="docType" {...register("docType")} className={igInput} />
        </InlineField>
      )}
      <InlineField id="tpl-name" label="Tên mẫu in" required error={errors.name?.message}>
        <input id="tpl-name" {...register("name")} className={igInput} />
      </InlineField>
      <InlineField id="tpl-title" label="Tiêu đề in" error={errors.title?.message}>
        <input id="tpl-title" {...register("title")} className={igInput} />
      </InlineField>
      <InlineField id="tpl-signer" label="Người ký" error={errors.signerName?.message}>
        <input id="tpl-signer" {...register("signerName")} className={igInput} />
      </InlineField>
      <InlineField id="tpl-phone" label="Số điện thoại in" error={errors.phone?.message}>
        <input id="tpl-phone" {...register("phone")} className={igInput} />
      </InlineField>
      <InlineField id="tpl-qr" label="Ảnh QR" error={errors.qrImage?.message} hint="/uploads/… hoặc https đã được cho phép">
        <input id="tpl-qr" {...register("qrImage")} className={igInput} />
      </InlineField>
      <InlineField id="tpl-webhook" label="Địa chỉ webhook (https)" error={errors.webhookUrl?.message} className="md:col-span-2"
        hint="Phần sau dấu ? không hiển thị lại; để nguyên ô này thì giữ địa chỉ đã lưu.">
        <input id="tpl-webhook" {...register("webhookUrl")} className={igInput} />
      </InlineField>
      <fieldset className="md:col-span-2 space-y-2 rounded-sm border border-border p-3">
        <legend className="px-1 text-xs font-semibold text-fg-secondary">Secret webhook</legend>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="radio" value="keep" {...register("secretAction")} />{hasSecret ? "Giữ secret hiện tại" : "Chưa đặt secret"}
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="radio" value="replace" {...register("secretAction")} />{hasSecret ? "Thay bằng secret mới" : "Đặt secret"}
        </label>
        {action === "replace" && (
          <InlineField id="tpl-secret" label="Secret mới" error={errors.secret?.message} hint="Tối thiểu 8 ký tự; chỉ lưu dạng mã hoá, không hiển thị lại.">
            <input id="tpl-secret" type="password" autoComplete="new-password" {...register("secret")} className={igInput} />
          </InlineField>
        )}
        {hasSecret && (
          <label className="flex min-h-10 items-center gap-2 text-sm text-danger">
            <input type="radio" value="clear" {...register("secretAction")} />Xoá secret
          </label>
        )}
      </fieldset>
      <InlineField id="tpl-footer" label="Ghi chú cuối phiếu" className="md:col-span-2" error={errors.footerNote?.message}>
        <textarea id="tpl-footer" rows={2} {...register("footerNote")} className={textarea} />
      </InlineField>
      <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" {...register("showCompanyInfo")} />In thông tin công ty</label>
      <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" {...register("isActive")} />Đang bật</label>
    </div>
  );
}

function TemplateSection({ ctx, tpl }: { ctx: TabRenderCtx; tpl: PrintTemplateDTO }) {
  const save = (value: UpdateTemplateInput) => apiFetch(`/api/company/templates/${tpl.id}`, { method: "PATCH", json: value }).then(() => undefined);
  return (
    <EditableSection
      ctx={ctx} k={`tpl-${tpl.id}`} title={`${tpl.name} · ${tpl.docType}`} editLabel={`Chỉnh sửa mẫu ${tpl.name}`} canEdit
      schema={updateTemplateSchema} save={save}
      defaults={{
        name: tpl.name, webhookUrl: tpl.webhookUrl, title: tpl.title, signerName: tpl.signerName, phone: tpl.phone, qrImage: tpl.qrImage,
        showCompanyInfo: tpl.showCompanyInfo, footerNote: tpl.footerNote, isActive: tpl.isActive, secretAction: "keep", secret: "",
      }}
      view={
        <dl className="space-y-2">
          <DetailField label="Trạng thái">{tpl.isActive ? <Badge tone="success">Đang bật</Badge> : <Badge tone="neutral">Đang tắt</Badge>}</DetailField>
          <DetailField label="Tiêu đề in">{tpl.title}</DetailField>
          <DetailField label="Người ký">{tpl.signerName}</DetailField>
          <DetailField label="Webhook">{tpl.webhookUrl}</DetailField>
          <DetailField label="Secret webhook">{tpl.hasSecret ? "Đã đặt (không hiển thị)" : "Chưa đặt"}</DetailField>
          <DetailField label="In thông tin công ty">{tpl.showCompanyInfo ? "Có" : "Không"}</DetailField>
        </dl>
      }
      edit={(form) => <TemplateFields form={form} hasSecret={tpl.hasSecret} creating={false} />}
    />
  );
}

function NewTemplateSection({ ctx }: { ctx: TabRenderCtx }) {
  const idem = useIdempotencyKey();
  const save = async (value: CreateTemplateInput) => {
    await apiFetch("/api/company/templates", { method: "POST", json: value, idempotencyKey: idem.key });
    idem.reset();
  };
  return (
    <EditableSection
      ctx={ctx} k="tpl-new" title="Thêm mẫu in" editLabel="Thêm mẫu in" canEdit schema={createTemplateSchema} save={save}
      defaults={emptyTemplate}
      view={<p className="text-sm text-fg-muted">Mỗi mẫu gắn với một loại chứng từ. Việc gửi webhook do giai đoạn sau đảm nhiệm.</p>}
      edit={(form) => <TemplateFields form={form} hasSecret={false} creating />}
    />
  );
}

export function CompanyDetail({ company, templates }: { company: CompanyDTO; templates: PrintTemplateDTO[] }) {
  const nav = useDetailNav(["company", "templates"], { info: "company", bank: "company" });
  const saveCompany = (section: "info" | "bank") => (value: object) =>
    apiFetch("/api/company", { method: "PATCH", json: { section, version: company.version, value } }).then(() => undefined);

  const companyTab = (ctx: TabRenderCtx) => (
    <div className="space-y-6">
      <EditableSection
        ctx={ctx} k="info" title="Thông tin công ty" editLabel="Chỉnh sửa thông tin công ty" canEdit schema={companyInfoSchema} save={saveCompany("info")}
        defaults={{ name: company.name, address: company.address, phone: company.phone, taxCode: company.taxCode, logo: company.logo }}
        view={
          <dl className="space-y-2">
            <DetailField label="Tên công ty">{company.name}</DetailField>
            <DetailField label="Địa chỉ">{company.address}</DetailField>
            <DetailField label="Điện thoại">{company.phone}</DetailField>
            <DetailField label="Mã số thuế">{company.taxCode}</DetailField>
            <DetailField label="Logo">{company.logo}</DetailField>
          </dl>
        }
        edit={(form) => (
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            <InlineField id="name" label="Tên công ty" required error={form.formState.errors.name?.message} className="md:col-span-2">
              <input id="name" {...form.register("name")} className={igInput} />
            </InlineField>
            <InlineField id="address" label="Địa chỉ" error={form.formState.errors.address?.message} className="md:col-span-2">
              <input id="address" {...form.register("address")} className={igInput} />
            </InlineField>
            <InlineField id="phone" label="Điện thoại" error={form.formState.errors.phone?.message}>
              <input id="phone" {...form.register("phone")} className={igInput} />
            </InlineField>
            <InlineField id="taxCode" label="Mã số thuế" error={form.formState.errors.taxCode?.message}>
              <input id="taxCode" {...form.register("taxCode")} className={igInput} />
            </InlineField>
            <InlineField id="logo" label="Logo" error={form.formState.errors.logo?.message} hint="/uploads/… hoặc https đã được cho phép" className="md:col-span-2">
              <input id="logo" {...form.register("logo")} className={igInput} />
            </InlineField>
          </div>
        )}
      />
      <EditableSection
        ctx={ctx} k="bank" title="Ngân hàng" editLabel="Chỉnh sửa thông tin ngân hàng" canEdit schema={companyBankSchema} save={saveCompany("bank")}
        defaults={company.bank}
        view={
          <dl className="space-y-2">
            <DetailField label="Ngân hàng">{company.bank.bankName}</DetailField>
            <DetailField label="Số tài khoản">{company.bank.accountNo}</DetailField>
            <DetailField label="Chủ tài khoản">{company.bank.accountHolder}</DetailField>
            <DetailField label="Chi nhánh">{company.bank.branch}</DetailField>
          </dl>
        }
        edit={(form) => (
          <div className="grid gap-x-6 gap-y-3 md:grid-cols-2">
            {(["bankName", "accountNo", "accountHolder", "branch"] as const).map((k, i) => (
              <InlineField key={k} id={`bank-${k}`} label={["Ngân hàng", "Số tài khoản", "Chủ tài khoản", "Chi nhánh"][i]!} error={form.formState.errors[k]?.message}>
                <input id={`bank-${k}`} {...form.register(k)} className={igInput} />
              </InlineField>
            ))}
          </div>
        )}
      />
    </div>
  );

  const templatesTab = (ctx: TabRenderCtx) => (
    <div className="space-y-6">
      {templates.map((t) => <TemplateSection key={t.id} ctx={ctx} tpl={t} />)}
      <NewTemplateSection ctx={ctx} />
    </div>
  );

  return (
    <DetailPage
      backHref="/" backLabel="Về trang chủ"
      summary={{
        title: company.name, code: company.taxCode || undefined, badges: [],
        facts: [{ label: "Mẫu in", value: templates.length }, { label: "Đang bật", value: templates.filter((t) => t.isActive).length }],
      }}
      tabs={[
        { key: "company", label: "Công ty", render: companyTab },
        { key: "templates", label: "Mẫu in", count: templates.length, render: templatesTab },
      ]}
      {...nav}
      initialEditing={nav.initialEditing}
    />
  );
}
