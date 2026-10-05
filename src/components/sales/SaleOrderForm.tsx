"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, FileText, Package, Plus, Printer, Save, ShoppingCart, SlidersHorizontal, Store, Trash2, UserRound, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, type UseFormReturn } from "react-hook-form";
import { addPickedLines, Combobox, Field, inputClass, NewPage, ProductMultiPicker, useLineEntry, type ComboOption } from "@/components/ui";
import { QuickCustomerDialog, type QuickCustomer } from "@/components/sales/QuickCustomerDialog";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "@/lib/toast";
import { formatCurrency, formatQty } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { ProductOption } from "@/server/products/queries";
import type { SaleFormOptions } from "@/server/sales/form-options";
import { SALE_MAX_LINES, SALE_PAYMENT_LABELS, SALE_PAYMENT_METHODS, saleOrderSchema, type SaleOrderInput } from "@/server/sales/schemas";
import type { SalePricingDTO } from "@/server/sales/pricing";

const emptyLine = { productId: undefined, unit: "", qty: undefined, salePrice: undefined, discountNow: 0, discountAccum: 0, processingTypeId: null, note: "" } as unknown as SaleOrderInput["lines"][number];
const num = (v: unknown) => Number(v) || 0;
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Màn hình bán hàng (mã 31). Tồn/giá gần nhất/giá nhập gần nhất chỉ hiện khi server trả (theo quyền).
 * Thiếu quyền `order.edit_price` → ô giá khoá ở giá gần nhất; server cũng kiểm lại (không tin UI).
 */
export interface SaleOrderEdit {
  orderId: number;
  code: string;
  /** Đơn nháp: chưa xuất kho → không có nút In, "Lưu thay đổi" chỉ sửa nháp. */
  isDraft?: boolean;
  customer: ComboOption;
  products: ProductOption[];
  defaults: SaleOrderInput;
}

export function SaleOrderForm({ today, canEditPrice, edit, options, retail }: { today: string; canEditPrice: boolean; edit?: SaleOrderEdit; options: SaleFormOptions; /** Chế độ "Bán lẻ tại quầy": khách lẻ + giao ngay + thu tiền mặt mặc định, bỏ các ô ít dùng. */ retail?: boolean }) {
  const retailOn = !!retail && !edit && options.canCollect;
  const router = useRouter();
  const idem = useIdempotencyKey();
  const form = useForm<SaleOrderInput>({
    resolver: zodResolver(saleOrderSchema),
    defaultValues: edit?.defaults ?? {
      partnerId: retailOn ? 1 : undefined, date: today, expectedDeliveryDate: today, note: "", lines: [emptyLine], shippingFee: 0, orderDiscount: 0,
      salesUserId: options.salesUsers.some((u) => u.value === options.currentUserId) ? options.currentUserId : null,
      warehouseId: options.warehouses[0] ? Number(options.warehouses[0].value) : null, paymentMethod: retailOn ? "CASH" : "NONE",
    },
  });
  const { control, register, handleSubmit, setValue, getValues, watch, formState: { errors, isDirty } } = form;
  // keyName riêng: khoá `id` của dòng đơn (khi sửa) không được bị useFieldArray ghi đè
  const { fields, append, remove, update } = useFieldArray({ control, name: "lines", keyName: "_key" });
  const lines = watch("lines");
  const partnerId = watch("partnerId");

  // Bán tại quầy: khách lẻ / thu tiền ngay / giao ngay (chỉ khi LẬP đơn mới và có quyền thu tiền)
  const canCheckout = !edit && options.canCollect;
  const [walkIn, setWalkIn] = useState(retailOn);
  const [walkName, setWalkName] = useState("");
  const [walkPhone, setWalkPhone] = useState("");
  const [pickupNow, setPickupNow] = useState(retailOn && options.canPickup);
  const [payKind, setPayKind] = useState<"NONE" | "CASH" | "TRANSFER" | "COD">(retailOn ? "CASH" : "NONE");
  const [payAmount, setPayAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [payAccount, setPayAccount] = useState<number | null>(() => { const c = retailOn ? options.cashAccounts.find((a) => a.type === "CASH") : undefined; return c ? Number(c.value) : null; });
  const [payNote, setPayNote] = useState("");
  // Khách lẻ chưa có hồ sơ: gợi ý giá lấy theo "giá gần nhất của bất kỳ khách" (id không tồn tại ⇒ không có giá riêng)
  const pricingPartnerId = walkIn ? options.walkInPartnerId ?? 2_147_483_647 : partnerId;

  const [customer, setCustomer] = useState<ComboOption | null>(edit?.customer ?? null);
  const [products, setProducts] = useState(() => new Map<number, ProductOption>((edit?.products ?? []).map((p) => [p.value, p] as const)));
  const [pricing, setPricing] = useState(() => new Map<string, SalePricingDTO | null>());
  const [processingTypes, setProcessingTypes] = useState<ComboOption[]>([]);
  const requested = useRef(new Set<string>());
  const key = (productId: number) => `${pricingPartnerId}:${productId}`;

  useEffect(() => { apiFetch<ComboOption[]>("/api/orders/options/processing-types").then(setProcessingTypes).catch(() => undefined); }, []);

  // Tải gợi ý (tồn, giá) cho các mã đã chọn khi đã có khách; đổi khách → tải lại (giá gần nhất theo từng khách)
  useEffect(() => {
    if (!pricingPartnerId) return;
    for (const l of lines) {
      const pid = l?.productId;
      if (!pid || requested.current.has(key(pid))) continue;
      requested.current.add(key(pid));
      apiFetch<SalePricingDTO | null>(`/api/orders/pricing?partnerId=${pricingPartnerId}&productId=${pid}`)
        .then((dto) => setPricing((m) => new Map(m).set(key(pid), dto)))
        .catch(() => requested.current.delete(key(pid)));
    }
  }, [pricingPartnerId, lines.map((l) => l?.productId).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Có giá gợi ý mới → điền vào ô giá còn trống (hoặc luôn ép khi không có quyền sửa giá)
  useEffect(() => {
    lines.forEach((l, i) => {
      const dto = l?.productId && pricingPartnerId ? pricing.get(key(l.productId)) : null;
      const suggested = dto?.units.find((u) => u.unit === l.unit)?.suggestedPrice;
      if (suggested == null) return;
      const current = getValues(`lines.${i}.salePrice`);
      // Dòng đã có trong đơn (đang sửa) giữ giá cũ; chỉ điền khi ô trống (đổi mã/đơn vị đã xoá ô giá)
      const existing = l.id !== undefined && !!num(current);
      if (existing) return;
      if (!canEditPrice ? num(current) !== Number(suggested) : !num(current)) setValue(`lines.${i}.salePrice`, Number(suggested), { shouldValidate: true });
    });
  }, [pricing, pricingPartnerId, lines.map((l) => `${l?.productId}:${l?.unit}`).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sau khi lưu: tuỳ chọn in hóa đơn (lỗi in không làm mất đơn đã lập — báo rồi vẫn sang trang chi tiết)
  const finish = async (id: number, print: boolean) => {
    if (print) {
      try {
        const r = await apiFetch<{ url: string }>(`/api/print/SALE_INVOICE/${id}`, { method: "POST" });
        window.open(r.url, "_blank", "noopener,noreferrer");
      } catch (e) { toast.error(`Đã lưu đơn nhưng chưa in được: ${e instanceof Error ? e.message : "lỗi không xác định"}`); }
    }
    router.replace(`/sales/orders/${id}`);
  };
  // Phần bán tại quầy gửi kèm đơn; kiểm tra sớm để báo lỗi rõ (server kiểm lại và là nơi quyết định)
  const buildCheckout = () => {
    if (!canCheckout) return undefined;
    const amount = payKind === "CASH" || payKind === "TRANSFER" ? num(payAmount) : 0;
    if (amount > total + 0.004) throw new Error("Số tiền thu vượt tiền phải thu.");
    if (amount > 0 && !payAccount) throw new Error("Chọn quỹ/tài khoản nhận tiền.");
    if (walkIn && amount + 0.004 < total) throw new Error("Khách lẻ phải thanh toán đủ tiền phải thu (không ghi nợ).");
    if (!walkIn && !pickupNow && amount <= 0) return undefined;
    return {
      ...(walkIn ? { walkIn: { name: walkName.trim(), phone: walkPhone.trim() } } : {}),
      ...(pickupNow ? { pickupNow: true } : {}),
      ...(amount > 0 ? { payment: { amount, cashAccountId: payAccount, note: payNote.trim() } } : {}),
    };
  };
  const submitWith = (mode: "save" | "print" | "draft") => handleSubmit(async (value) => {
    if (edit) {
      await apiFetch(`/api/orders/${edit.orderId}`, { method: "PATCH", json: value });
      await finish(edit.orderId, mode === "print" && !edit.isDraft);
      return;
    }
    const checkout = mode !== "draft" ? buildCheckout() : undefined;
    const r = await apiFetch<{ id: number }>(mode === "draft" ? "/api/orders/draft" : "/api/orders", { method: "POST", json: checkout ? { ...value, checkout } : value, idempotencyKey: idem.key });
    await finish(r.id, mode === "print");
  });

  const entry = useLineEntry({ count: fields.length, getLines: () => getValues("lines"), append, remove, blank: emptyLine, qtyLabel: (i) => `Số lượng dòng ${i + 1}`, max: SALE_MAX_LINES });
  const addProducts = (picked: ProductOption[]) => {
    setProducts((m) => new Map([...m, ...picked.map((p) => [p.value, p] as const)]));
    addPickedLines(picked, getValues("lines"), (p) => ({ ...emptyLine, productId: p.value, unit: p.baseUnit }), { update, append: (vs) => append(vs) }, SALE_MAX_LINES);
  };
  const linesTotal = lines.reduce((sum, l) => sum + round2(num(l?.qty) * num(l?.salePrice)) - num(l?.discountNow), 0);
  const orderDiscount = num(watch("orderDiscount"));
  const shippingFee = num(watch("shippingFee"));
  const total = round2(linesTotal - orderDiscount + shippingFee);
  const accounts = options.cashAccounts.filter((a) => (payKind === "CASH" ? a.type === "CASH" : a.type === "BANK"));
  const paid = payKind === "CASH" || payKind === "TRANSFER" ? num(payAmount) : 0;
  const changeKind = (k: typeof payKind) => {
    setPayKind(k);
    setValue("paymentMethod", k, { shouldDirty: true });
    const list = options.cashAccounts.filter((a) => (k === "CASH" ? a.type === "CASH" : a.type === "BANK"));
    setPayAccount(k === "CASH" || k === "TRANSFER" ? (list[0] ? Number(list[0].value) : null) : null);
    if (k === "CASH" || k === "TRANSFER") { if (!amountTouched) setPayAmount(total ? String(total) : ""); } else { setPayAmount(""); setAmountTouched(false); }
  };
  // Chưa chỉnh tay số tiền thì số thu bám theo tiền phải thu (thu đủ)
  useEffect(() => { if (canCheckout && (payKind === "CASH" || payKind === "TRANSFER") && !amountTouched) setPayAmount(total ? String(total) : ""); }, [total]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleWalkIn = (on: boolean) => {
    setWalkIn(on); setCustomer(null);
    setValue("partnerId", on ? 1 : (undefined as never), { shouldDirty: true });
    setPickupNow(on && options.canPickup);
    if (on && (payKind === "NONE" || payKind === "COD")) changeKind("CASH");
    if (!on) changeKind("NONE");
  };
  const loadCustomers = (q: string) => apiFetch<ComboOption[]>(`/api/partner-lists/customers/search?q=${encodeURIComponent(q)}`);
  const loadProducts = async (q: string) => {
    const rows = await apiFetch<ProductOption[]>(`/api/products/search?q=${encodeURIComponent(q)}`);
    setProducts((m) => new Map([...m, ...rows.map((r) => [r.value, r] as const)]));
    return rows;
  };

  const runWith = (mode: "save" | "print" | "draft") => async () => { entry.dropEmptyLines(); await submitWith(mode)(); };
  const canPrint = options.canPrint && !edit?.isDraft;
  const [quickKey, setQuickKey] = useState(0);
  const [printMenu, setPrintMenu] = useState(false);
  const addQuick = (p: ComboOption | null) => { if (!p) return; addProducts([p as ProductOption]); setQuickKey((k) => k + 1); };
  const lineCount = lines.filter((l) => l?.productId).length;
  const customerInfo = customer as (ComboOption & { address?: string; taxCode?: string; deliveryAddress?: string }) | null;
  const card = "rounded-sm border border-border bg-surface p-4";

  // Một trang, các thẻ: khách hàng | thông tin chung ở trên, danh sách sản phẩm ở dưới — lập đơn không phải chuyển tab.
  return (
    <NewPage wide backHref={edit ? `/sales/orders/${edit.orderId}` : "/sales/orders"} backLabel={edit ? `Quay lại đơn ${edit.code}` : "Quay lại danh sách đơn"} title={edit ? `Sửa đơn ${edit.code}` : retailOn ? "Bán lẻ tại quầy" : "Tạo đơn hàng"} submitLabel={edit ? "Lưu thay đổi" : retailOn ? "Thu tiền & lập đơn" : "Lập đơn"} isDirty={() => isDirty} onSubmit={runWith("save")}
      headerActions={(run, pending) => (
        <>
          {!edit && options.canCollect && (
            <Link href={retailOn ? "/sales/orders/new" : "/sales/orders/new?mode=retail"} className="inline-flex h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm font-medium hover:bg-hover md:h-10"><Store size={16} aria-hidden /> {retailOn ? "Đơn thường" : "Bán lẻ tại quầy"}</Link>
          )}
          {!edit && !walkIn && (
            <button type="button" disabled={pending} onClick={() => run(runWith("draft"))} className="inline-flex h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm font-medium hover:bg-hover disabled:opacity-50 md:h-10"><Save size={16} aria-hidden /> Lưu nháp</button>
          )}
          {canPrint && (
            <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPrintMenu(false); }}>
              <button type="button" disabled={pending} aria-haspopup="menu" aria-expanded={printMenu} onClick={() => setPrintMenu((o) => !o)} className="inline-flex h-11 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm font-medium hover:bg-hover disabled:opacity-50 md:h-10"><Printer size={16} aria-hidden /> In đơn hàng <ChevronDown size={14} aria-hidden /></button>
              {printMenu && (
                <div role="menu" className="absolute right-0 z-dropdown mt-1 min-w-56 rounded-sm border border-border bg-raised p-1 shadow-lg">
                  <button type="button" role="menuitem" onClick={() => { setPrintMenu(false); run(runWith("print")); }} className="flex h-11 w-full items-center gap-2 rounded-sm px-3 text-left text-sm hover:bg-hover md:h-9">{edit ? "Lưu thay đổi và in hóa đơn" : "Lập đơn và in hóa đơn"}</button>
                </div>
              )}
            </div>
          )}
        </>
      )}>
      <div className={retailOn ? "grid gap-4 lg:grid-cols-2" : "grid gap-4 lg:grid-cols-3"}>
        <section className={card}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><UserRound size={16} aria-hidden className="text-accent" /> Thông tin khách hàng</h2>
            {canCheckout && (
              <div role="group" aria-label="Loại khách" className="inline-flex overflow-hidden rounded-full border border-border text-xs font-medium">
                <button type="button" aria-pressed={!walkIn} onClick={() => walkIn && toggleWalkIn(false)} className={walkIn ? "px-3 py-1.5 hover:bg-hover" : "bg-accent px-3 py-1.5 text-fg-on-accent"}>Đối tác</button>
                <button type="button" aria-pressed={walkIn} onClick={() => !walkIn && toggleWalkIn(true)} className={walkIn ? "bg-accent px-3 py-1.5 text-fg-on-accent" : "px-3 py-1.5 hover:bg-hover"}>Khách lẻ</button>
              </div>
            )}
          </div>
          {walkIn ? (
            <div className="space-y-3">
              <Field id="walkName" label="Tên khách (tuỳ chọn)"><input id="walkName" value={walkName} onChange={(e) => setWalkName(e.target.value)} placeholder="Khách lẻ" className={inputClass()} /></Field>
              <Field id="walkPhone" label="Số điện thoại (tuỳ chọn)"><input id="walkPhone" value={walkPhone} onChange={(e) => setWalkPhone(e.target.value)} inputMode="tel" className={inputClass()} /></Field>
              <p className="text-xs text-fg-muted">Khách lẻ dùng khách chung <strong>KHL</strong>, thanh toán đủ ngay, không ghi nợ.</p>
            </div>
          ) : (<>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Controller control={control} name="partnerId" render={({ field }) => (
                <Combobox label="Khách hàng" value={field.value ? customer : null} loadOptions={loadCustomers} placeholder="Tìm khách hàng…" error={errors.partnerId?.message}
                  onChange={(o) => { setCustomer(o); field.onChange(o ? Number(o.value) : undefined); }} />
              )} />
            </div>
            {options.canCreateCustomer && !edit && (
              <QuickCustomerDialog groups={options.groups} onCreated={(c: QuickCustomer) => { setCustomer(c); setValue("partnerId", Number(c.value), { shouldValidate: true, shouldDirty: true }); }} />
            )}
          </div>
          {customerInfo && (customerInfo.hint || customerInfo.address || customerInfo.taxCode || customerInfo.deliveryAddress) && (
            <dl className="mt-3 space-y-1 rounded-sm bg-hover p-3 text-sm">
              {customerInfo.hint && <div className="flex gap-2"><dt className="shrink-0 text-fg-muted">SĐT:</dt><dd>{customerInfo.hint}</dd></div>}
              {customerInfo.taxCode && <div className="flex gap-2"><dt className="shrink-0 text-fg-muted">MST:</dt><dd>{customerInfo.taxCode}</dd></div>}
              {customerInfo.address && <div className="flex gap-2"><dt className="shrink-0 text-fg-muted">Địa chỉ:</dt><dd>{customerInfo.address}</dd></div>}
              {customerInfo.deliveryAddress && <div className="flex gap-2"><dt className="shrink-0 text-fg-muted">Giao hàng:</dt><dd>{customerInfo.deliveryAddress}</dd></div>}
            </dl>
          )}
          </>)}
        </section>
        <section className={card}>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><FileText size={16} aria-hidden className="text-accent" /> Thông tin chung</h2>
          <div className="grid gap-4 xl:grid-cols-2">
            <Field id="date" label="Ngày đơn" required error={errors.date?.message}>
              <input id="date" type="date" max={today} {...register("date")} className={inputClass(errors.date)} />
            </Field>
            {!retailOn && (
              <Field id="expectedDeliveryDate" label="Ngày giao dự kiến" required error={errors.expectedDeliveryDate?.message}>
                <input id="expectedDeliveryDate" type="date" {...register("expectedDeliveryDate")} className={inputClass(errors.expectedDeliveryDate)} />
              </Field>
            )}
          </div>
          <div className="mt-4">
            <Field id="note" label="Ghi chú" error={errors.note?.message}>
              <textarea id="note" rows={2} placeholder="Nhập ghi chú về đơn hàng…" {...register("note")} className="w-full rounded-sm border border-border bg-canvas px-3 py-2 text-sm" />
            </Field>
          </div>
        </section>
        {!retailOn && <section className={card}>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal size={16} aria-hidden className="text-accent" /> Thông tin khác</h2>
          <div className="space-y-4">
            <Field id="salesUserId" label="Nhân viên bán">
              <select id="salesUserId" value={watch("salesUserId") ?? ""} onChange={(e) => setValue("salesUserId", e.target.value ? Number(e.target.value) : null, { shouldDirty: true })} className={inputClass()}>
                <option value="">— Không chọn —</option>
                {options.salesUsers.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </Field>
            <Field id="warehouseId" label="Kho xuất">
              <select id="warehouseId" value={watch("warehouseId") ?? ""} onChange={(e) => setValue("warehouseId", e.target.value ? Number(e.target.value) : null, { shouldDirty: true })} className={inputClass()}>
                <option value="">— Không chọn —</option>
                {options.warehouses.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </Field>
            {!canCheckout && (
              <Field id="paymentMethod" label="Hình thức thanh toán">
                <select id="paymentMethod" {...register("paymentMethod")} className={inputClass()}>
                  {SALE_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{SALE_PAYMENT_LABELS[m]}</option>)}
                </select>
              </Field>
            )}
          </div>
        </section>}
      </div>

      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><ShoppingCart size={16} aria-hidden className="text-accent" /> Danh sách sản phẩm</h2>
          <div className="flex min-w-0 flex-1 flex-wrap items-end justify-end gap-2">
            <div className="min-w-56 max-w-md flex-1">
              <Combobox key={quickKey} label="Tìm sản phẩm nhanh" value={null} loadOptions={loadProducts} placeholder="Tìm sản phẩm (mã, tên…)" onChange={addQuick} disabled={fields.length >= SALE_MAX_LINES} />
            </div>
            <button type="button" onClick={() => append(emptyLine)} disabled={fields.length >= SALE_MAX_LINES}
              className="inline-flex h-11 items-center gap-1 rounded-sm bg-accent px-4 text-sm font-medium text-fg-on-accent disabled:opacity-40 md:h-10"><Plus size={16} aria-hidden /> Thêm dòng</button>
            <ProductMultiPicker load={loadProducts} disabled={fields.length >= SALE_MAX_LINES} existingIds={lines.flatMap((l) => (l?.productId ? [l.productId] : []))} onPicked={addProducts} />
          </div>
        </div>
        {!canEditPrice && <p className="mb-2 text-xs text-fg-muted">Bạn không có quyền sửa giá: đơn giá được lấy theo giá bán gần nhất.</p>}
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="line-table w-full min-w-[1250px] text-sm">
            <thead>
              <tr className="border-b border-border bg-hover text-left text-xs font-semibold text-fg-secondary">
                <th className="w-12 px-2 py-2 text-center">STT</th><th className="px-2 py-2">Sản phẩm <span className="text-danger">*</span></th><th className="px-2 py-2">ĐVT</th><th className="px-2 py-2 text-right">SL <span className="text-danger">*</span></th>
                <th className="px-2 py-2 text-right">Đơn giá</th><th className="px-2 py-2 text-right">CK trừ ngay</th><th className="px-2 py-2 text-right">CK tích lũy</th>
                <th className="px-2 py-2">Gia công</th><th className="px-2 py-2">Ghi chú</th><th className="px-2 py-2 text-right">Thành tiền</th><th className="px-2 py-2 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field, index) => (
                <LineRow key={field._key} index={index} form={form} products={products} setProducts={setProducts} loadProducts={loadProducts}
                  onProductPicked={() => entry.onProductPicked(index)} onQtyKeyDown={entry.onQtyKeyDown(index)}
                  dto={lines[index]?.productId && pricingPartnerId ? pricing.get(key(lines[index]!.productId)) ?? null : null}
                  processingTypes={processingTypes} canEditPrice={canEditPrice} canRemove={fields.length > 1} onRemove={() => remove(index)} />
              ))}
            </tbody>
          </table>
        </div>
        {errors.lines?.message && <p role="alert" className="mt-2 text-sm text-danger">{errors.lines.message}</p>}
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4 border-t border-border pt-3">
          <p className="text-sm">Tổng số dòng: <span className="font-semibold tabular">{lineCount}</span></p>
          <div className="flex flex-wrap items-end gap-4">
            <p className="text-sm text-fg-secondary">Tiền hàng <span className="ml-1 font-semibold text-fg tabular">{formatCurrency(linesTotal)}</span></p>
            <Field id="orderDiscount" label="Chiết khấu cả đơn" className="w-36" error={errors.orderDiscount?.message}>
              <input id="orderDiscount" type="number" min={0} step="any" {...register("orderDiscount", { setValueAs: (v) => (v === "" || v == null ? 0 : Number(v)) })} className={`${inputClass(errors.orderDiscount)} tabular text-right`} />
            </Field>
            <Field id="shippingFee" label="Phí vận chuyển" className="w-36" error={errors.shippingFee?.message}>
              <input id="shippingFee" type="number" min={0} step="any" {...register("shippingFee", { setValueAs: (v) => (v === "" || v == null ? 0 : Number(v)) })} className={`${inputClass(errors.shippingFee)} tabular text-right`} />
            </Field>
            <p className="text-sm font-semibold">Tiền phải thu <span className="ml-3 text-xl text-accent tabular">{formatCurrency(total)}</span></p>
          </div>
        </div>
        <p className="mt-2 text-xs text-fg-muted">Chọn sản phẩm → nhập SL → Enter để sang dòng tiếp theo; dòng trống cuối sẽ bị bỏ khi lập đơn.</p>
      </section>

      {canCheckout && (
        <section className={card}>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Wallet size={16} aria-hidden className="text-accent" /> Thông tin thanh toán</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field id="payKind" label="Hình thức thanh toán">
              <select id="payKind" value={payKind} onChange={(e) => changeKind(e.target.value as typeof payKind)} className={inputClass()}>
                <option value="NONE">Chưa thu tiền</option>
                <option value="CASH">Tiền mặt</option>
                <option value="TRANSFER">Chuyển khoản</option>
                {!walkIn && <option value="COD">Thu hộ khi giao (COD)</option>}
              </select>
            </Field>
            {(payKind === "CASH" || payKind === "TRANSFER") && (<>
              <Field id="payAccount" label={payKind === "CASH" ? "Quỹ tiền mặt" : "Ngân hàng"}>
                <select id="payAccount" value={payAccount ?? ""} onChange={(e) => setPayAccount(e.target.value ? Number(e.target.value) : null)} className={inputClass()}>
                  <option value="">{accounts.length ? "— Chọn —" : "Chưa có tài khoản phù hợp"}</option>
                  {accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </Field>
              <Field id="payAmount" label="Số tiền thu">
                <div className="flex gap-2">
                  <input id="payAmount" type="number" min={0} step="any" value={payAmount} onChange={(e) => { setPayAmount(e.target.value); setAmountTouched(true); }} className={`${inputClass()} tabular text-right`} />
                  <button type="button" onClick={() => { setPayAmount(total ? String(total) : ""); setAmountTouched(false); }} className="h-11 shrink-0 rounded-sm border border-border px-3 text-sm font-medium hover:bg-hover md:h-9">Thu đủ</button>
                </div>
              </Field>
              <Field id="payNote" label="Ghi chú thu tiền"><input id="payNote" value={payNote} onChange={(e) => setPayNote(e.target.value)} className={inputClass()} /></Field>
            </>)}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            {options.canPickup ? (
              <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={pickupNow} onChange={(e) => setPickupNow(e.target.checked)} className="h-4 w-4" />Khách tự chở — giao hàng ngay (lập phiếu giao)</label>
            ) : <span />}
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="flex gap-2"><dt className="text-fg-muted">Tiền phải thu:</dt><dd className="font-semibold tabular">{formatCurrency(total)}</dd></div>
              <div className="flex gap-2"><dt className="text-fg-muted">Đã thu:</dt><dd className="font-semibold tabular">{formatCurrency(paid)}</dd></div>
              <div className="flex gap-2"><dt className="text-fg-muted">{paid > total ? "Thừa:" : "Còn nợ:"}</dt><dd className={`font-semibold tabular ${paid > total || (walkIn && paid < total) ? "text-danger" : ""}`}>{formatCurrency(Math.abs(total - paid))}</dd></div>
            </dl>
          </div>
        </section>
      )}
    </NewPage>
  );
}

function LineRow({ index, form, products, setProducts, loadProducts, dto, processingTypes, canEditPrice, canRemove, onRemove, onProductPicked, onQtyKeyDown }: {
  onProductPicked: () => void; onQtyKeyDown: (e: React.KeyboardEvent) => void;
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
      <td className="min-w-72 px-2 py-2" data-line-product={index} data-label="Sản phẩm" data-wide>
        <div className="flex items-start gap-2">
        <ProductThumb url={product?.imageUrl} name={product?.label} />
        <div className="min-w-0 flex-1">
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
        </div>
        </div>
        <div className="mt-1 space-y-0.5 text-xs text-fg-secondary">
          {dto?.onHand !== undefined && <p>Tồn: {formatQty(dto.onHand)} {dto.baseUnit}</p>}
          {short && <p role="status" className="font-medium text-warning">Không đủ tồn — sẽ thành đơn treo</p>}
          {dto?.lastSalePrice != null && <p>Giá gần nhất{dto.lastSalePriceForPartner ? " (khách này)" : " (khách khác)"}: {formatCurrency(dto.lastSalePrice)}/{dto.baseUnit}</p>}
          {dto?.lastPurchasePrice != null && <p>Giá nhập gần nhất: {formatCurrency(dto.lastPurchasePrice)}/{dto.baseUnit}</p>}
        </div>
      </td>
      <td data-label="ĐVT" className="px-2 py-2">
        {/* Điều khiển bằng state: select không điều khiển bị đặt giá trị trước khi <option> kịp render nên hiện trống */}
        <select aria-label={`Đơn vị dòng ${index + 1}`} value={line?.unit ?? ""} className={`${inputClass(err?.unit)} min-w-20`}
          onChange={(e) => { setValue(`lines.${index}.unit`, e.target.value, { shouldValidate: true, shouldDirty: true }); setValue(`lines.${index}.salePrice`, undefined as never); }}>
          <option value="">—</option>
          {(product?.units ?? []).map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
        </select>
      </td>
      <td data-label="Số lượng" className="px-2 py-2"><input aria-label={`Số lượng dòng ${index + 1}`} type="number" min={0} step="any" {...register(`lines.${index}.qty`, { valueAsNumber: true })}
        onKeyDown={onQtyKeyDown} className={`${inputClass(err?.qty)} min-w-20 tabular text-right`} /></td>
      <td data-label="Đơn giá" className="px-2 py-2">
        <input aria-label={`Đơn giá dòng ${index + 1}`} type="number" min={0} step="any" readOnly={!canEditPrice} {...register(`lines.${index}.salePrice`, { valueAsNumber: true })}
          className={`${inputClass(err?.salePrice)} min-w-28 tabular text-right ${canEditPrice ? "" : "bg-hover"}`} />
      </td>
      <td data-label="CK trừ ngay" className="px-2 py-2">
        <input aria-label={`Chiết khấu trừ ngay dòng ${index + 1}`} type="number" min={0} step="any" {...register(`lines.${index}.discountNow`, { valueAsNumber: true })} className={`${inputClass(err?.discountNow)} min-w-24 tabular text-right`} />
        {err?.discountNow?.message && <p role="alert" className="mt-1 text-xs text-danger">{err.discountNow.message}</p>}
      </td>
      <td data-label="CK tích lũy" className="px-2 py-2"><input aria-label={`Chiết khấu tích lũy dòng ${index + 1}`} type="number" min={0} step="any" {...register(`lines.${index}.discountAccum`, { valueAsNumber: true })} className={`${inputClass(err?.discountAccum)} min-w-24 tabular text-right`} /></td>
      <td data-label="Gia công" className="px-2 py-2">
        <select aria-label={`Kiểu gia công dòng ${index + 1}`} value={line?.processingTypeId ?? ""} onChange={(e) => setValue(`lines.${index}.processingTypeId`, e.target.value ? Number(e.target.value) : null, { shouldDirty: true })} className={inputClass()}>
          <option value="">Không</option>
          {processingTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td data-label="Ghi chú" className="px-2 py-2"><input aria-label={`Ghi chú dòng ${index + 1}`} maxLength={200} {...register(`lines.${index}.note`)} className={`${inputClass(err?.note)} min-w-36`} /></td>
      <td data-label="Thành tiền" className="px-2 py-2 text-right tabular">{formatCurrency(amount)}</td>
      <td data-action className="px-2 py-2 text-center"><button type="button" aria-label={`Xóa dòng ${index + 1}`} onClick={onRemove} disabled={!canRemove} className="inline-flex h-11 w-11 items-center justify-center rounded-sm text-danger hover:bg-danger-soft disabled:opacity-40 md:h-9 md:w-9"><Trash2 size={16} aria-hidden /></button></td>
    </tr>
  );
}

/** Ảnh sản phẩm 40px (hoặc khung trống có icon). Ảnh lỗi → quay về khung trống. */
function ProductThumb({ url, name }: { url?: string | null; name?: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) return <img src={url} alt={name ?? ""} loading="lazy" onError={() => setFailed(true)} className="mt-5 h-10 w-10 shrink-0 rounded-sm border border-border object-cover" />;
  return <span aria-hidden className="mt-5 flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-border bg-hover text-fg-muted"><Package size={18} /></span>;
}
