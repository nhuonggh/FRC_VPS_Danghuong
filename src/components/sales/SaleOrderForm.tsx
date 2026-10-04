"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, type UseFormReturn } from "react-hook-form";
import { Combobox, Field, inputClass, NewPage, type ComboOption } from "@/components/ui";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatQty } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { ProductOption } from "@/server/products/queries";
import { SALE_MAX_LINES, saleOrderSchema, type SaleOrderInput } from "@/server/sales/schemas";
import type { SalePricingDTO } from "@/server/sales/pricing";

const emptyLine = { productId: undefined, unit: "", qty: undefined, salePrice: undefined, discountNow: 0, discountAccum: 0, processingTypeId: null } as unknown as SaleOrderInput["lines"][number];
const num = (v: unknown) => Number(v) || 0;
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Màn hình bán hàng (mã 31). Tồn/giá gần nhất/giá nhập gần nhất chỉ hiện khi server trả (theo quyền).
 * Thiếu quyền `order.edit_price` → ô giá khoá ở giá gần nhất; server cũng kiểm lại (không tin UI).
 */
export interface SaleOrderEdit {
  orderId: number;
  code: string;
  customer: ComboOption;
  products: ProductOption[];
  defaults: SaleOrderInput;
}

export function SaleOrderForm({ today, canEditPrice, edit }: { today: string; canEditPrice: boolean; edit?: SaleOrderEdit }) {
  const router = useRouter();
  const idem = useIdempotencyKey();
  const form = useForm<SaleOrderInput>({
    resolver: zodResolver(saleOrderSchema),
    defaultValues: edit?.defaults ?? { partnerId: undefined, date: today, expectedDeliveryDate: today, note: "", lines: [emptyLine] },
  });
  const { control, register, handleSubmit, setValue, getValues, watch, formState: { errors, isDirty } } = form;
  // keyName riêng: khoá `id` của dòng đơn (khi sửa) không được bị useFieldArray ghi đè
  const { fields, append, remove } = useFieldArray({ control, name: "lines", keyName: "_key" });
  const lines = watch("lines");
  const partnerId = watch("partnerId");

  const [customer, setCustomer] = useState<ComboOption | null>(edit?.customer ?? null);
  const [products, setProducts] = useState(() => new Map<number, ProductOption>((edit?.products ?? []).map((p) => [p.value, p] as const)));
  const [pricing, setPricing] = useState(() => new Map<string, SalePricingDTO | null>());
  const [processingTypes, setProcessingTypes] = useState<ComboOption[]>([]);
  const requested = useRef(new Set<string>());
  const key = (productId: number) => `${partnerId}:${productId}`;

  useEffect(() => { apiFetch<ComboOption[]>("/api/orders/options/processing-types").then(setProcessingTypes).catch(() => undefined); }, []);

  // Tải gợi ý (tồn, giá) cho các mã đã chọn khi đã có khách; đổi khách → tải lại (giá gần nhất theo từng khách)
  useEffect(() => {
    if (!partnerId) return;
    for (const l of lines) {
      const pid = l?.productId;
      if (!pid || requested.current.has(key(pid))) continue;
      requested.current.add(key(pid));
      apiFetch<SalePricingDTO | null>(`/api/orders/pricing?partnerId=${partnerId}&productId=${pid}`)
        .then((dto) => setPricing((m) => new Map(m).set(key(pid), dto)))
        .catch(() => requested.current.delete(key(pid)));
    }
  }, [partnerId, lines.map((l) => l?.productId).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Có giá gợi ý mới → điền vào ô giá còn trống (hoặc luôn ép khi không có quyền sửa giá)
  useEffect(() => {
    lines.forEach((l, i) => {
      const dto = l?.productId && partnerId ? pricing.get(key(l.productId)) : null;
      const suggested = dto?.units.find((u) => u.unit === l.unit)?.suggestedPrice;
      if (suggested == null) return;
      const current = getValues(`lines.${i}.salePrice`);
      // Dòng đã có trong đơn (đang sửa) giữ giá cũ; chỉ điền khi ô trống (đổi mã/đơn vị đã xoá ô giá)
      const existing = l.id !== undefined && !!num(current);
      if (existing) return;
      if (!canEditPrice ? num(current) !== Number(suggested) : !num(current)) setValue(`lines.${i}.salePrice`, Number(suggested), { shouldValidate: true });
    });
  }, [pricing, partnerId, lines.map((l) => `${l?.productId}:${l?.unit}`).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Dòng trống (chưa chọn SP, chưa nhập SL) chỉ là chỗ nhập tiếp: bỏ trước khi kiểm tra, trừ khi toàn bộ đều trống (để hiện lỗi). */
  const dropEmptyLines = () => {
    const cur = getValues("lines");
    const empty = cur.map((l, i) => (!l?.productId && !num(l?.qty) ? i : -1)).filter((i) => i >= 0);
    if (empty.length > 0 && empty.length < cur.length) remove(empty);
  };
  const focusProduct = (i: number) => requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-line-product="${i}"] input`)?.focus()));
  const focusQty = (i: number) => requestAnimationFrame(() => document.querySelector<HTMLElement>(`input[aria-label="Số lượng dòng ${i + 1}"]`)?.focus());
  /** Chọn xong SP ở dòng cuối → tự mở dòng trống kế tiếp; focus nhảy sang ô SL. */
  const onProductPicked = (i: number) => {
    if (i === fields.length - 1 && fields.length < SALE_MAX_LINES) append(emptyLine, { shouldFocus: false });
    focusQty(i);
  };
  /** Enter ở ô SL → sang ô tìm SP của dòng kế (tạo dòng mới nếu đang ở dòng cuối). */
  const nextLine = (i: number) => {
    if (i === fields.length - 1) { if (fields.length >= SALE_MAX_LINES) return; append(emptyLine, { shouldFocus: false }); }
    focusProduct(i + 1);
  };

  const submit = handleSubmit(async (value) => {
    if (edit) {
      await apiFetch(`/api/orders/${edit.orderId}`, { method: "PATCH", json: value });
      router.replace(`/sales/orders/${edit.orderId}`);
      return;
    }
    const r = await apiFetch<{ id: number }>("/api/orders", { method: "POST", json: value, idempotencyKey: idem.key });
    router.replace(`/sales/orders/${r.id}`);
  });

  const total = lines.reduce((sum, l) => sum + round2(num(l?.qty) * num(l?.salePrice)) - num(l?.discountNow), 0);
  const loadCustomers = (q: string) => apiFetch<ComboOption[]>(`/api/partner-lists/customers/search?q=${encodeURIComponent(q)}`);
  const loadProducts = async (q: string) => {
    const rows = await apiFetch<ProductOption[]>(`/api/products/search?q=${encodeURIComponent(q)}`);
    setProducts((m) => new Map([...m, ...rows.map((r) => [r.value, r] as const)]));
    return rows;
  };

  // Một trang: thông tin chung ở trên, dòng hàng ở dưới — lập đơn không phải chuyển qua lại giữa các tab.
  return (
    <NewPage backHref={edit ? `/sales/orders/${edit.orderId}` : "/sales/orders"} backLabel={edit ? `Quay lại đơn ${edit.code}` : "Quay lại danh sách đơn"} title={edit ? `Sửa đơn ${edit.code}` : "Bán hàng"} submitLabel={edit ? "Lưu thay đổi" : "Lập đơn"} isDirty={() => isDirty} onSubmit={async () => { dropEmptyLines(); await submit(); }}>
    <div className="space-y-6">
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Controller control={control} name="partnerId" render={({ field }) => (
            <Combobox label="Khách hàng" value={field.value ? customer : null} loadOptions={loadCustomers} placeholder="Tìm khách hàng…" error={errors.partnerId?.message}
              onChange={(o) => { setCustomer(o); field.onChange(o ? Number(o.value) : undefined); }} />
          )} />
          <Field id="date" label="Ngày đơn" required error={errors.date?.message}>
            <input id="date" type="date" max={today} {...register("date")} className={inputClass(errors.date)} />
          </Field>
          <Field id="expectedDeliveryDate" label="Ngày giao dự kiến" required error={errors.expectedDeliveryDate?.message}>
            <input id="expectedDeliveryDate" type="date" {...register("expectedDeliveryDate")} className={inputClass(errors.expectedDeliveryDate)} />
          </Field>
        </div>
        <Field id="note" label="Ghi chú" error={errors.note?.message}>
          <textarea id="note" rows={3} {...register("note")} className="w-full rounded-sm border border-border bg-canvas px-3 py-2 text-sm" />
        </Field>
      </div>
      <div className="space-y-3 border-t border-border pt-5">
        <h2 className="text-sm font-semibold">Dòng hàng</h2>
        {!canEditPrice && <p className="text-xs text-fg-muted">Bạn không có quyền sửa giá: đơn giá được lấy theo giá bán gần nhất.</p>}

        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="w-full min-w-[1050px] text-sm">
            <thead>
              <tr className="border-b border-border bg-hover text-left text-xs font-semibold text-fg-secondary">
                <th className="px-2 py-2">Sản phẩm</th><th className="px-2 py-2">ĐVT</th><th className="px-2 py-2 text-right">SL</th>
                <th className="px-2 py-2 text-right">Đơn giá</th><th className="px-2 py-2 text-right">CK trừ ngay</th><th className="px-2 py-2 text-right">CK tích lũy</th>
                <th className="px-2 py-2">Gia công</th><th className="px-2 py-2 text-right">Thành tiền</th><th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {fields.map((field, index) => (
                <LineRow key={field._key} index={index} form={form} products={products} setProducts={setProducts} loadProducts={loadProducts}
                  onProductPicked={() => onProductPicked(index)} onQtyEnter={() => nextLine(index)}
                  dto={lines[index]?.productId && partnerId ? pricing.get(key(lines[index]!.productId)) ?? null : null}
                  processingTypes={processingTypes} canEditPrice={canEditPrice} canRemove={fields.length > 1} onRemove={() => remove(index)} />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-hover font-semibold">
                <td colSpan={7} className="px-2 py-3 text-right">Tiền phải thu</td>
                <td className="px-2 py-3 text-right tabular">{formatCurrency(total)}</td><td />
              </tr>
            </tfoot>
          </table>
        </div>
        {errors.lines?.message && <p role="alert" className="text-sm text-danger">{errors.lines.message}</p>}
        <button type="button" onClick={() => append(emptyLine)} disabled={fields.length >= SALE_MAX_LINES}
          className="h-11 rounded-sm border border-border px-4 text-sm font-medium hover:bg-hover disabled:opacity-40 md:h-10">+ Thêm dòng</button>
        <p className="text-xs text-fg-muted">Chọn sản phẩm → nhập SL → Enter để sang dòng tiếp theo; dòng trống cuối sẽ bị bỏ khi lập đơn.</p>
      </div>
    </div>
    </NewPage>
  );
}

function LineRow({ index, form, products, setProducts, loadProducts, dto, processingTypes, canEditPrice, canRemove, onRemove, onProductPicked, onQtyEnter }: {
  onProductPicked: () => void; onQtyEnter: () => void;
  index: number; form: UseFormReturn<SaleOrderInput>; products: Map<number, ProductOption>;
  setProducts: React.Dispatch<React.SetStateAction<Map<number, ProductOption>>>; loadProducts: (q: string) => Promise<ProductOption[]>;
  dto: SalePricingDTO | null; processingTypes: ComboOption[]; canEditPrice: boolean; canRemove: boolean; onRemove: () => void;
}) {
  const { control, register, setValue, watch, formState: { errors } } = form;
  const line = watch(`lines.${index}`);
  const err = errors.lines?.[index];
  const product = line?.productId ? products.get(line.productId) ?? null : null;
  const factor = num(dto?.units.find((u) => u.unit === line?.unit)?.factor ?? product?.units.find((u) => u.unit === line?.unit)?.factor) || 1;
  const qtyBase = num(line?.qty) / factor;
  const short = dto?.onHand !== undefined && qtyBase > num(dto.onHand);
  const amount = round2(num(line?.qty) * num(line?.salePrice)) - num(line?.discountNow);
  const allLines = watch("lines");
  const dupIndex = line?.productId ? allLines.findIndex((l, i) => i < index && l?.productId === line.productId && l?.unit === line.unit) : -1;
  const duplicateOf = dupIndex + 1; // 0 = không trùng; số dòng (1-based) của dòng trước đã có cùng SP + ĐVT

  return (
    <tr className="border-b border-border align-top last:border-b-0">
      <td className="min-w-64 px-2 py-2" data-line-product={index}>
        <Controller control={control} name={`lines.${index}.productId`} render={({ field }) => (
          <Combobox label={`Sản phẩm dòng ${index + 1}`} value={product} loadOptions={loadProducts} placeholder="Tìm mã, tên…" error={err?.productId?.message}
            onChange={(o) => {
              const p = o as ProductOption | null;
              field.onChange(p ? Number(p.value) : undefined);
              if (p) setProducts((m) => new Map(m).set(p.value, p));
              setValue(`lines.${index}.unit`, p?.baseUnit ?? "", { shouldValidate: true });
              setValue(`lines.${index}.salePrice`, undefined as never);
              if (p) onProductPicked();
            }} />
        )} />
        {duplicateOf > 0 && <p role="status" className="mt-1 text-xs font-medium text-warning">Sản phẩm này đã có ở dòng {duplicateOf}</p>}
        <div className="mt-1 space-y-0.5 text-xs text-fg-secondary">
          {dto?.onHand !== undefined && <p>Tồn: {formatQty(dto.onHand)} {dto.baseUnit}</p>}
          {short && <p role="status" className="font-medium text-warning">Không đủ tồn — sẽ thành đơn treo</p>}
          {dto?.lastSalePrice != null && <p>Giá gần nhất{dto.lastSalePriceForPartner ? " (khách này)" : " (khách khác)"}: {formatCurrency(dto.lastSalePrice)}/{dto.baseUnit}</p>}
          {dto?.lastPurchasePrice != null && <p>Giá nhập gần nhất: {formatCurrency(dto.lastPurchasePrice)}/{dto.baseUnit}</p>}
        </div>
      </td>
      <td className="px-2 py-2">
        {/* Điều khiển bằng state: select không điều khiển bị đặt giá trị trước khi <option> kịp render nên hiện trống */}
        <select aria-label={`Đơn vị dòng ${index + 1}`} value={line?.unit ?? ""} className={`${inputClass(err?.unit)} min-w-20`}
          onChange={(e) => { setValue(`lines.${index}.unit`, e.target.value, { shouldValidate: true, shouldDirty: true }); setValue(`lines.${index}.salePrice`, undefined as never); }}>
          <option value="">—</option>
          {(product?.units ?? []).map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
        </select>
      </td>
      <td className="px-2 py-2"><input aria-label={`Số lượng dòng ${index + 1}`} type="number" min={0} step="any" {...register(`lines.${index}.qty`, { valueAsNumber: true })}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onQtyEnter(); } }} className={`${inputClass(err?.qty)} min-w-20 tabular text-right`} /></td>
      <td className="px-2 py-2">
        <input aria-label={`Đơn giá dòng ${index + 1}`} type="number" min={0} step="any" readOnly={!canEditPrice} {...register(`lines.${index}.salePrice`, { valueAsNumber: true })}
          className={`${inputClass(err?.salePrice)} min-w-28 tabular text-right ${canEditPrice ? "" : "bg-hover"}`} />
      </td>
      <td className="px-2 py-2">
        <input aria-label={`Chiết khấu trừ ngay dòng ${index + 1}`} type="number" min={0} step="any" {...register(`lines.${index}.discountNow`, { valueAsNumber: true })} className={`${inputClass(err?.discountNow)} min-w-24 tabular text-right`} />
        {err?.discountNow?.message && <p role="alert" className="mt-1 text-xs text-danger">{err.discountNow.message}</p>}
      </td>
      <td className="px-2 py-2"><input aria-label={`Chiết khấu tích lũy dòng ${index + 1}`} type="number" min={0} step="any" {...register(`lines.${index}.discountAccum`, { valueAsNumber: true })} className={`${inputClass(err?.discountAccum)} min-w-24 tabular text-right`} /></td>
      <td className="px-2 py-2">
        <select aria-label={`Kiểu gia công dòng ${index + 1}`} value={line?.processingTypeId ?? ""} onChange={(e) => setValue(`lines.${index}.processingTypeId`, e.target.value ? Number(e.target.value) : null, { shouldDirty: true })} className={inputClass()}>
          <option value="">Không</option>
          {processingTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td className="px-2 py-2 text-right tabular">{formatCurrency(amount)}</td>
      <td className="px-2 py-2"><button type="button" aria-label={`Xóa dòng ${index + 1}`} onClick={onRemove} disabled={!canRemove} className="h-11 w-11 text-danger hover:bg-danger-soft disabled:opacity-40 md:h-9 md:w-9">×</button></td>
    </tr>
  );
}
