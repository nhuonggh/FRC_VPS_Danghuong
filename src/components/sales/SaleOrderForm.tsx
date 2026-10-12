"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarDays, ChevronDown, Package, Plus, Printer, Save, ShoppingCart, Store, Trash2, UserRound, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, type UseFormReturn } from "react-hook-form";
import { addPickedLines, Combobox, inputClass, NewPage, ProductMultiPicker, useLineEntry, type ComboOption, RhfNumberInput, NumberInput } from "@/components/ui";
import { igCombo, igInput, InlineField } from "@/components/sales/InlineField";
import { QuickCustomerDialog, type QuickCustomer } from "@/components/sales/QuickCustomerDialog";
import { SaleLineEntry } from "@/components/sales/SaleLineEntry";
import { apiFetch } from "@/lib/api-fetch";
import { toast } from "@/lib/toast";
import { formatCurrency, formatQty } from "@/lib/format";
import { sameUnit } from "@/lib/price-basis";
import { useIdempotencyKey } from "@/lib/use-idempotency-key";
import type { ProductOption } from "@/server/products/queries";
import type { SaleFormOptions } from "@/server/sales/form-options";
import { SALE_MAX_LINES, SALE_PAYMENT_LABELS, SALE_PAYMENT_METHODS, saleOrderSchema, type SaleOrderInput } from "@/server/sales/schemas";
import type { SalePricingDTO } from "@/server/sales/pricing";
import { buildDimNote, parseDimNote, parseLengthExpr, pricePerM2, pricePerMd, termArea, termNote, termQty, type LengthTerm } from "@/lib/length-expr";

import type { TypeOption } from "@/components/sales/QuickDimensionEntry";

const LABEL = "sm:min-w-40";
/** Nhãn trong ô tìm khách là "MÃ — Tên"; lấy phần mã để hiện ở ô "Mã khách hàng". */
const partnerCode = (label: string) => (label.includes(" — ") ? label.split(" — ")[0]! : "");
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
  const { fields, append, remove, update, insert } = useFieldArray({ control, name: "lines", keyName: "_key" });
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
  // Khoản thu thứ 2 bằng hình thức còn lại (vd 5 triệu tiền mặt + phần còn lại chuyển khoản), cùng lúc với khoản 1
  const [secAmount, setSecAmount] = useState("");
  const [secAccount, setSecAccount] = useState<number | null>(null);
  // Khách lẻ chưa có hồ sơ: gợi ý giá lấy theo "giá gần nhất của bất kỳ khách" (id không tồn tại ⇒ không có giá riêng)
  const pricingPartnerId = walkIn ? options.walkInPartnerId ?? 2_147_483_647 : partnerId;

  const [customer, setCustomer] = useState<ComboOption | null>(edit?.customer ?? null);
  const [products, setProducts] = useState(() => new Map<number, ProductOption>((edit?.products ?? []).map((p) => [p.value, p] as const)));
  const [pricing, setPricing] = useState(() => new Map<string, SalePricingDTO | null>());
  const requested = useRef(new Set<string>());
  const key = (productId: number, typeId?: number | null) => `${pricingPartnerId}:${productId}:${typeId ?? 0}`;


  // Tải gợi ý (tồn, giá) cho các mã đã chọn khi đã có khách; đổi khách → tải lại (giá gần nhất theo từng khách)
  useEffect(() => {
    if (!pricingPartnerId) return;
    for (const l of lines) {
      const pid = l?.productId, tid = l?.processingTypeId ?? null;
      if (!pid || requested.current.has(key(pid, tid))) continue;
      requested.current.add(key(pid, tid));
      apiFetch<SalePricingDTO | null>(`/api/orders/pricing?partnerId=${pricingPartnerId}&productId=${pid}${tid ? `&processingTypeId=${tid}` : ""}`)
        .then((dto) => setPricing((m) => new Map(m).set(key(pid, tid), dto)))
        .catch(() => requested.current.delete(key(pid, tid)));
    }
  }, [pricingPartnerId, lines.map((l) => `${l?.productId}:${l?.processingTypeId ?? 0}`).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Có giá gợi ý mới → điền vào ô giá còn trống (hoặc luôn ép khi không có quyền sửa giá)
  useEffect(() => {
    lines.forEach((l, i) => {
      const dto = l?.productId && pricingPartnerId ? pricing.get(key(l.productId, l.processingTypeId)) : null;
      const suggested = dto?.units.find((u) => u.unit === l.unit)?.suggestedPrice;
      if (suggested == null) return;
      const current = getValues(`lines.${i}.salePrice`);
      // Dòng đã có trong đơn (đang sửa) giữ giá cũ; chỉ điền khi ô trống (đổi mã/đơn vị đã xoá ô giá)
      const existing = l.id !== undefined && !!num(current);
      if (existing) return;
      if (!canEditPrice ? num(current) !== Number(suggested) : !num(current)) setValue(`lines.${i}.salePrice`, Number(suggested), { shouldValidate: true });
    });
  }, [pricing, pricingPartnerId, lines.map((l) => `${l?.productId}:${l?.unit}:${l?.processingTypeId ?? 0}`).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const first = payKind === "CASH" || payKind === "TRANSFER" ? num(payAmount) : 0;
    const second = first > 0 || secAmount ? num(secAmount) : 0;
    const amount = first + second;
    if (amount > total + 0.004) throw new Error("Số tiền thu vượt tiền phải thu.");
    if (first > 0 && !payAccount) throw new Error("Chọn quỹ/tài khoản nhận tiền.");
    if (second > 0 && !secAccount) throw new Error("Chọn quỹ/tài khoản cho khoản thu thứ hai.");
    if (walkIn && amount + 0.004 < total) throw new Error("Khách lẻ phải thanh toán đủ tiền phải thu (không ghi nợ).");
    if (!walkIn && !pickupNow && amount <= 0) return undefined;
    return {
      ...(walkIn ? { walkIn: { name: walkName.trim(), phone: walkPhone.trim() } } : {}),
      ...(pickupNow ? { pickupNow: true } : {}),
      ...(amount > 0 ? { payments: [...(first > 0 ? [{ amount: first, cashAccountId: payAccount, note: payNote.trim() }] : []), ...(second > 0 ? [{ amount: second, cashAccountId: secAccount, note: payNote.trim() }] : [])] } : {}),
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
  /** Bán tôn theo kích thước: mỗi số hạng "dài*số tấm" thành 1 dòng cùng sản phẩm/kiểu gia công/đơn giá (dòng đang nhập giữ vị trí, các dòng sau chèn liền kề). */
  const expandDimensions = (index: number, terms: LengthTerm[], ratio: number) => {
    const base = getValues(`lines.${index}`);
    const rows = terms.map((t, k) => ({ ...base, id: k === 0 ? base.id : undefined, qty: termQty(t), note: [base.note?.trim(), termNote(t, ratio)].filter(Boolean).join(" — ") }));
    update(index, rows[0]!);
    if (rows.length > 1) insert(index + 1, rows.slice(1));
  };
  /** Dòng từ khối nhập nhanh theo kích thước: lấp các dòng trống trước, còn lại thêm cuối. */
  const addDimensionRows = (product: ProductOption, rows: SaleOrderInput["lines"]) => {
    setProducts((m) => new Map(m).set(product.value, product));
    const current = getValues("lines");
    const blanks = current.flatMap((l, i) => (l?.productId ? [] : [i]));
    rows.slice(0, blanks.length).forEach((r, k) => update(blanks[k], r));
    const rest = rows.slice(blanks.length);
    if (rest.length) append(rest.slice(0, Math.max(0, SALE_MAX_LINES - current.length)));
  };
  const addProducts = (picked: ProductOption[]) => {
    setProducts((m) => new Map([...m, ...picked.map((p) => [p.value, p] as const)]));
    addPickedLines(picked, getValues("lines"), (p) => ({ ...emptyLine, productId: p.value, unit: p.baseUnit }), { update, append: (vs) => append(vs) }, SALE_MAX_LINES);
  };
  const linesTotal = lines.reduce((sum, l) => sum + round2(num(l?.qty) * num(l?.salePrice)) - num(l?.discountNow), 0);
  const orderDiscount = num(watch("orderDiscount"));
  const shippingFee = num(watch("shippingFee"));
  const total = round2(linesTotal - orderDiscount + shippingFee);
  const accounts = options.cashAccounts.filter((a) => (payKind === "CASH" ? a.type === "CASH" : a.type === "BANK"));
  const otherAccounts = options.cashAccounts.filter((a) => (payKind === "CASH" ? a.type === "BANK" : a.type === "CASH"));
  const paid = (payKind === "CASH" || payKind === "TRANSFER" ? num(payAmount) : 0) + num(secAmount);
  const changeKind = (k: typeof payKind) => {
    setPayKind(k);
    setValue("paymentMethod", k, { shouldDirty: true });
    const list = options.cashAccounts.filter((a) => (k === "CASH" ? a.type === "CASH" : a.type === "BANK"));
    setPayAccount(k === "CASH" || k === "TRANSFER" ? (list[0] ? Number(list[0].value) : null) : null);
    setSecAmount(""); setSecAccount(null);
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
  const [printMenu, setPrintMenu] = useState(false);
  const lineCount = lines.filter((l) => l?.productId).length;
  const customerInfo = customer as (ComboOption & { address?: string; taxCode?: string; deliveryAddress?: string }) | null;
  const card = "rounded-sm border border-border bg-surface p-4";

  // Một trang, các thẻ: khách hàng | thông tin chung ở trên, danh sách sản phẩm ở dưới — lập đơn không phải chuyển tab.
  return (
    <NewPage wide backHref={edit ? `/sales/orders/${edit.orderId}` : "/sales/orders"} backLabel={edit ? `Quay lại đơn ${edit.code}` : "Quay lại danh sách đơn"} title={edit ? `Sửa đơn ${edit.code}` : retailOn ? "Bán lẻ tại quầy" : "Tạo đơn hàng"} submitLabel={edit ? "Lưu thay đổi" : retailOn ? "Thu tiền & lập đơn" : "Lập đơn"} isDirty={() => isDirty} onSubmit={runWith("save")}
      footerInfo={(
        <>
          <span className="text-sm font-semibold">Tổng tiền: <b className="ml-1 text-lg text-accent tabular">{formatCurrency(total)}</b></span>
          <span className="text-sm font-semibold">{paid > total && canCheckout ? "Thừa" : "Nợ"}: <b className={`ml-1 text-lg tabular ${(paid > total || (walkIn && paid < total)) && canCheckout ? "text-danger" : "text-accent"}`}>{formatCurrency(canCheckout ? Math.abs(total - paid) : total)}</b></span>
        </>
      )}
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
      {/* 1. Ngày tạo đơn */}
      <section className={card}>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><CalendarDays size={16} aria-hidden className="text-accent" /> Ngày tạo đơn</h2>
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
          <InlineField id="date" label="Ngày đơn" required error={errors.date?.message} labelClass={LABEL}>
            <input id="date" type="date" max={today} {...register("date")} aria-invalid={!!errors.date} className={igInput} />
          </InlineField>
          {!retailOn && (
            <InlineField id="expectedDeliveryDate" label="Ngày giao dự kiến" required error={errors.expectedDeliveryDate?.message} labelClass={LABEL}>
              <input id="expectedDeliveryDate" type="date" {...register("expectedDeliveryDate")} aria-invalid={!!errors.expectedDeliveryDate} className={igInput} />
            </InlineField>
          )}
          {!retailOn && (
            <InlineField id="salesUserId" label="Nhân viên bán" labelClass={LABEL}>
              <select id="salesUserId" value={watch("salesUserId") ?? ""} onChange={(e) => setValue("salesUserId", e.target.value ? Number(e.target.value) : null, { shouldDirty: true })} className={`${igInput} cursor-pointer`}>
                <option value="">— Không chọn —</option>
                {options.salesUsers.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </InlineField>
          )}
        </div>
      </section>

      {/* 2. Thông tin đối tác */}
      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><UserRound size={16} aria-hidden className="text-accent" /> Thông tin đối tác</h2>
          {canCheckout && (
            <div role="group" aria-label="Loại khách" className="inline-flex overflow-hidden rounded-full border border-border text-xs font-medium">
              <button type="button" aria-pressed={!walkIn} onClick={() => walkIn && toggleWalkIn(false)} className={walkIn ? "px-4 py-2 hover:bg-hover" : "bg-accent px-4 py-2 text-fg-on-accent"}>Đối tác</button>
              <button type="button" aria-pressed={walkIn} onClick={() => !walkIn && toggleWalkIn(true)} className={walkIn ? "bg-accent px-4 py-2 text-fg-on-accent" : "px-4 py-2 hover:bg-hover"}>Khách lẻ</button>
            </div>
          )}
          {options.canCreateCustomer && !edit && !walkIn
            ? <QuickCustomerDialog groups={options.groups} onCreated={(c: QuickCustomer) => { setCustomer(c); setValue("partnerId", Number(c.value), { shouldValidate: true, shouldDirty: true }); }} />
            : <span />}
        </div>
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
          {walkIn ? (<>
            <InlineField id="walkName" label="Tên khách (tuỳ chọn)" labelClass={LABEL}><input id="walkName" value={walkName} onChange={(e) => setWalkName(e.target.value)} placeholder="Khách lẻ (tuỳ chọn)" autoComplete="off" className={igInput} /></InlineField>
            <InlineField id="walkCode" label="Mã khách hàng" labelClass={LABEL} readOnly><input id="walkCode" readOnly value="KHL" className={igInput} /></InlineField>
            <InlineField id="walkPhone" label="Số điện thoại (tuỳ chọn)" labelClass={LABEL}><input id="walkPhone" value={walkPhone} onChange={(e) => setWalkPhone(e.target.value)} inputMode="tel" placeholder="Tuỳ chọn" className={igInput} /></InlineField>
            <p className="text-xs text-fg-muted md:col-span-2 xl:col-span-3">Khách lẻ dùng khách chung <strong>KHL</strong>, thanh toán đủ ngay, không ghi nợ.</p>
          </>) : (<>
            <InlineField id="partnerId" label="Tên khách hàng" required error={errors.partnerId?.message} labelClass={LABEL}>
              <div className={igCombo}>
                <Controller control={control} name="partnerId" render={({ field }) => (
                  <Combobox hideLabel label="Khách hàng" value={field.value ? customer : null} loadOptions={loadCustomers} placeholder="Tìm khách hàng…"
                    onChange={(o) => { setCustomer(o); field.onChange(o ? Number(o.value) : undefined); }} />
                )} />
              </div>
            </InlineField>
            <InlineField id="ccode" label="Mã khách hàng" labelClass={LABEL} readOnly><input id="ccode" readOnly value={customer ? partnerCode(customer.label) : ""} className={igInput} /></InlineField>
            <InlineField id="cphone" label="Điện thoại" labelClass={LABEL} readOnly><input id="cphone" readOnly value={customerInfo?.hint ?? ""} className={igInput} /></InlineField>
            <InlineField id="caddr" label="Địa chỉ" labelClass={LABEL} readOnly className="md:col-span-2"><input id="caddr" readOnly value={customerInfo?.address ?? ""} className={igInput} /></InlineField>
            <InlineField id="ctax" label="Mã số thuế" labelClass={LABEL} readOnly><input id="ctax" readOnly value={customerInfo?.taxCode ?? ""} className={igInput} /></InlineField>
            <InlineField id="cship" label="Địa chỉ giao hàng" labelClass={LABEL} readOnly className="md:col-span-2 xl:col-span-3"><input id="cship" readOnly value={customerInfo?.deliveryAddress ?? ""} className={igInput} /></InlineField>
          </>)}
        </div>
      </section>

      {/* 3. Thông tin sản phẩm (dải nhập) */}
      <section className={card}>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Package size={16} aria-hidden className="text-accent" /> Thông tin sản phẩm</h2>
        <SaleLineEntry loadProducts={loadProducts} pricingPartnerId={pricingPartnerId} canEditPrice={canEditPrice} disabled={fields.length >= SALE_MAX_LINES}
          warehouses={options.warehouses} warehouseId={watch("warehouseId") ?? null} onWarehouse={(id) => setValue("warehouseId", id, { shouldDirty: true })} onAdd={addDimensionRows} />
        {!canEditPrice && <p className="mt-2 text-xs text-fg-muted">Bạn không có quyền sửa giá: đơn giá được lấy theo giá bán gần nhất.</p>}
      </section>

      {/* 4. Chi tiết sản phẩm */}
      <section className={card}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><ShoppingCart size={16} aria-hidden className="text-accent" /> Chi tiết sản phẩm</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => append(emptyLine)} disabled={fields.length >= SALE_MAX_LINES}
              className="inline-flex h-11 items-center gap-1 rounded-sm border border-border bg-surface px-3 text-sm font-medium hover:bg-hover disabled:opacity-40 md:h-10"><Plus size={16} aria-hidden /> Thêm dòng</button>
            <ProductMultiPicker load={loadProducts} disabled={fields.length >= SALE_MAX_LINES} existingIds={lines.flatMap((l) => (l?.productId ? [l.productId] : []))} onPicked={addProducts} />
          </div>
        </div>
        <div className="overflow-x-auto rounded-sm border border-border">
          <table className="line-table w-full min-w-[1460px] table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-12" /><col className="w-[300px]" /><col className="w-24" /><col className="w-24" /><col className="w-32" /><col className="w-28" /><col className="w-28" /><col className="w-56" /><col className="w-44" /><col className="w-36" /><col className="w-16" />
            </colgroup>
            <thead>
              <tr className="bg-hover text-xs font-semibold text-fg-secondary">
                <th className="border border-border px-2 py-2.5 text-center">STT</th><th className="border border-border px-2 py-2.5 text-left">Sản phẩm <span className="text-danger">*</span></th><th className="border border-border px-2 py-2.5 text-center">ĐVT</th><th className="border border-border px-2 py-2.5 text-right">SL <span className="text-danger">*</span></th>
                <th className="border border-border px-2 py-2.5 text-right">Đơn giá</th><th className="border border-border px-2 py-2.5 text-right">CK trừ ngay</th><th className="border border-border px-2 py-2.5 text-right">CK tích lũy</th><th className="border border-border px-2 py-2.5 text-left">Gia công</th><th className="border border-border px-2 py-2.5 text-left">Ghi chú</th><th className="border border-border px-2 py-2.5 text-right">Thành tiền</th><th className="border border-border px-2 py-2.5 text-center">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field, index) => (
                <LineRow key={field._key} index={index} form={form} products={products} setProducts={setProducts} loadProducts={loadProducts}
                  onProductPicked={() => entry.onProductPicked(index)} onQtyKeyDown={entry.onQtyKeyDown(index)}
                  dto={lines[index]?.productId && pricingPartnerId ? pricing.get(key(lines[index]!.productId, lines[index]!.processingTypeId)) ?? null : null}
                  onExpand={(terms, ratio) => expandDimensions(index, terms, ratio)}
                  canEditPrice={canEditPrice} canRemove={fields.length > 1} onRemove={() => remove(index)} />
              ))}
            </tbody>
          </table>
        </div>
        {errors.lines?.message && <p role="alert" className="mt-2 text-sm text-danger">{errors.lines.message}</p>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <p className="text-sm">Tổng số dòng: <span className="font-semibold tabular">{lineCount}</span></p>
          <p className="text-sm text-fg-secondary">Tiền hàng <span className="ml-1 font-semibold text-fg tabular">{formatCurrency(linesTotal)}</span></p>
        </div>
        <p className="mt-2 text-xs text-fg-muted">Dòng đã thêm vẫn sửa trực tiếp được trong bảng; chọn sản phẩm → nhập SL → Enter để sang dòng kế. Dòng trống cuối sẽ bị bỏ khi lập đơn.</p>
      </section>

      {/* 5. Thông tin thanh toán */}
      <section className={card}>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Wallet size={16} aria-hidden className="text-accent" /> Thông tin thanh toán</h2>
        <div className="grid gap-x-6 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
          {canCheckout ? (<>
            <InlineField id="payKind" label="Hình thức thanh toán" labelClass={LABEL}>
              <select id="payKind" value={payKind} onChange={(e) => changeKind(e.target.value as typeof payKind)} className={`${igInput} cursor-pointer`}>
                <option value="NONE">Chưa thu tiền</option>
                <option value="CASH">Tiền mặt</option>
                <option value="TRANSFER">Chuyển khoản</option>
                {!walkIn && <option value="COD">Thu hộ khi giao (COD)</option>}
              </select>
            </InlineField>
            {(payKind === "CASH" || payKind === "TRANSFER") ? (
              <InlineField id="payAccount" label={payKind === "CASH" ? "Quỹ tiền mặt" : "Ngân hàng"} labelClass={LABEL}>
                <select id="payAccount" value={payAccount ?? ""} onChange={(e) => setPayAccount(e.target.value ? Number(e.target.value) : null)} className={`${igInput} cursor-pointer`}>
                  <option value="">{accounts.length ? "— Chọn —" : "Chưa có tài khoản phù hợp"}</option>
                  {accounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </InlineField>
            ) : <span className="hidden md:block" />}
          </>) : (
            <InlineField id="paymentMethod" label="Hình thức thanh toán" labelClass={LABEL}>
              <select id="paymentMethod" {...register("paymentMethod")} className={`${igInput} cursor-pointer`}>
                {SALE_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{SALE_PAYMENT_LABELS[m]}</option>)}
              </select>
            </InlineField>
          )}
          <InlineField id="shippingFee" label="Phí vận chuyển" error={errors.shippingFee?.message} labelClass={LABEL}>
            <RhfNumberInput id="shippingFee" control={control} name="shippingFee" empty={0} className={`${igInput} tabular text-right`} />
          </InlineField>

          {canCheckout && (payKind === "CASH" || payKind === "TRANSFER") && (<>
            <InlineField id="payAmount" label="Số tiền thu" labelClass={LABEL}>
              <NumberInput id="payAmount" value={payAmount} onValueChange={(val) => { setPayAmount(val); setAmountTouched(true); }} className={`${igInput} tabular text-right`} />
              <button type="button" onClick={() => { setPayAmount(total ? String(Math.max(0, round2(total - num(secAmount)))) : ""); setAmountTouched(true); }} className="h-11 shrink-0 border-l border-border bg-hover px-3 text-sm font-medium hover:bg-border md:h-9">Thu đủ</button>
            </InlineField>
            <InlineField id="secAmount" label={payKind === "CASH" ? "Thu thêm bằng chuyển khoản" : "Thu thêm bằng tiền mặt"} labelClass={LABEL}>
              <NumberInput id="secAmount" value={secAmount} placeholder="0"
                onValueChange={(val) => { setSecAmount(val); if (!secAccount && otherAccounts[0]) setSecAccount(Number(otherAccounts[0].value)); if (!amountTouched) setPayAmount(String(Math.max(0, round2(total - num(val))))); }} className={`${igInput} tabular text-right`} />
            </InlineField>
          </>)}
          <InlineField id="orderDiscount" label="Chiết khấu cả đơn" error={errors.orderDiscount?.message} labelClass={LABEL}>
            <RhfNumberInput id="orderDiscount" control={control} name="orderDiscount" empty={0} className={`${igInput} tabular text-right`} />
          </InlineField>
          {canCheckout && (payKind === "CASH" || payKind === "TRANSFER") && (<>
            {num(secAmount) > 0 && (
              <InlineField id="secAccount" label={payKind === "CASH" ? "Ngân hàng nhận (khoản 2)" : "Quỹ tiền mặt (khoản 2)"} labelClass={LABEL}>
                <select id="secAccount" value={secAccount ?? ""} onChange={(e) => setSecAccount(e.target.value ? Number(e.target.value) : null)} className={`${igInput} cursor-pointer`}>
                  <option value="">{otherAccounts.length ? "— Chọn —" : "Chưa có tài khoản phù hợp"}</option>
                  {otherAccounts.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                </select>
              </InlineField>
            )}
            <InlineField id="payNote" label="Ghi chú thu tiền" labelClass={LABEL} className={num(secAmount) > 0 ? undefined : "md:col-span-2"}><input id="payNote" value={payNote} onChange={(e) => setPayNote(e.target.value)} className={igInput} /></InlineField>
          </>)}
          <InlineField id="note" label="Ghi chú" error={errors.note?.message} labelClass={LABEL} className="md:col-span-2 xl:col-span-3">
            <textarea id="note" rows={2} placeholder="Nhập ghi chú về đơn hàng…" {...register("note")} className="min-h-11 min-w-0 flex-1 resize-y bg-transparent px-3 py-2 text-sm outline-none" />
          </InlineField>
        </div>
        {canCheckout && (<>
          <p className="mt-3 text-xs text-fg-muted">Tiền thu khi chưa giao hàng được ghi là <strong>tiền cọc</strong> của đơn (trừ vào công nợ khi giao). Có thể thu bằng cả tiền mặt và chuyển khoản cùng lúc.</p>
          {options.canPickup && (
            <div className="mt-2 border-t border-border pt-3">
              <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={pickupNow} onChange={(e) => setPickupNow(e.target.checked)} className="h-4 w-4" />Khách tự chở — giao hàng ngay (lập phiếu giao)</label>
            </div>
          )}
        </>)}
      </section>
    </NewPage>
  );
}

function LineRow({ index, form, products, setProducts, loadProducts, dto, canEditPrice, canRemove, onRemove, onProductPicked, onQtyKeyDown, onExpand }: {
  onExpand: (terms: LengthTerm[], ratio: number) => void;
  onProductPicked: () => void; onQtyKeyDown: (e: React.KeyboardEvent) => void;
  index: number; form: UseFormReturn<SaleOrderInput>; products: Map<number, ProductOption>;
  setProducts: React.Dispatch<React.SetStateAction<Map<number, ProductOption>>>; loadProducts: (q: string) => Promise<ProductOption[]>;
  dto: SalePricingDTO | null; canEditPrice: boolean; canRemove: boolean; onRemove: () => void;
}) {
  const { control, register, setValue, watch, formState: { errors } } = form;
  const line = watch(`lines.${index}`);
  const err = errors.lines?.[index];
  const product = line?.productId ? products.get(line.productId) ?? null : null;
  const factor = num(dto?.units.find((u) => u.unit === line?.unit)?.factor ?? product?.units.find((u) => u.unit === line?.unit)?.factor) || 1;
  const qtyBase = num(line?.qty) / factor;
  const short = dto?.onHand !== undefined && qtyBase > num(dto.onHand);
  const amount = round2(num(line?.qty) * num(line?.salePrice)) - num(line?.discountNow);
  // Kiểu gia công chỉ gồm những kiểu SP này có định mức (BOM); giữ kiểu đang chọn (đơn đang sửa) kể cả khi định mức đã ngừng
  const [types, setTypes] = useState<TypeOption[]>([]);
  const [ratioInput, setRatioInput] = useState("1"); // chưa có tỷ lệ ⇒ mặc định 1, người bán sửa rồi lưu cho lần sau
  const [lengthExpr, setLengthExpr] = useState("");
  const [dimError, setDimError] = useState("");
  const productId = line?.productId;
  useEffect(() => {
    if (!productId) { setTypes([]); return; }
    let live = true;
    apiFetch<TypeOption[]>(`/api/orders/options/processing-types?productId=${productId}`).then((t) => { if (live) setTypes(t); }).catch(() => { if (live) setTypes([]); });
    return () => { live = false; };
  }, [productId]);
  const allLines = watch("lines");
  const dupIndex = line?.productId ? allLines.findIndex((l, i) => i < index && l?.productId === line.productId && l?.unit === line.unit) : -1;
  const duplicateOf = dupIndex + 1; // 0 = không trùng; số dòng (1-based) của dòng trước đã có cùng SP + ĐVT

  // Bán theo kích thước: tỷ lệ m²/md của kiểu gia công (đã lưu ở định mức, hoặc người bán nhập lần đầu rồi lưu lại)
  const typeId = line?.processingTypeId ?? null;
  const currentType = typeId ? types.find((t) => Number(t.value) === typeId) ?? null : null;
  const ratio = currentType?.ratio ?? (Number(ratioInput.replace(",", ".")) || 0);
  const ratioKnown = !!currentType?.ratio;
  // Kiểu gia công tính giá theo m²: cột Đơn giá nhập/hiện giá/m² (giá lưu vẫn là giá/md = giá/m² × tỷ lệ)
  const isUnitBasis = currentType?.priceBasis === "UNIT"; // bán theo ĐVT riêng của kiểu: không có tỷ lệ m²/md, chiều dài
  const areaRow = currentType?.priceBasis === "AREA" && ratio > 0 && (!product || line?.unit === product.baseUnit);
  const submitLength = async () => {
    if (!lengthExpr.trim()) return;
    const parsed = parseLengthExpr(lengthExpr);
    if ("error" in parsed) { setDimError(parsed.error); return; }
    if (!(ratio > 0)) { setDimError("Nhập tỷ lệ m²/md trước."); return; }
    if (!ratioKnown && productId && typeId) {
      try {
        const r = await apiFetch<{ ratio: string }>("/api/orders/processing-ratio", { method: "POST", json: { productId, processingTypeId: typeId, ratio } });
        setTypes((all) => all.map((t) => (Number(t.value) === typeId ? { ...t, ratio: Number(r.ratio) } : t)));
      } catch (e) { setDimError(e instanceof Error ? e.message : "Không lưu được tỷ lệ."); return; }
    }
    setDimError(""); setLengthExpr("");
    onExpand(parsed.terms, ratio);
  };

  // Dòng sinh từ chiều dài: sửa Dài / Số tấm / Giá m² ngay tại dòng, SL (md), ghi chú và thành tiền tự tính lại (như màn bán hàng cũ).
  const dim = typeId ? parseDimNote(line?.note) : null;
  const rowRatio = dim?.ratio ?? ratio; // dòng tách theo chiều dài ghi sẵn tỷ lệ đã dùng trong ghi chú
  const setDim = (patch: { length?: number; pieces?: number }) => {
    if (!dim) return;
    const t: LengthTerm = { length: patch.length ?? dim.length, pieces: patch.pieces ?? dim.pieces };
    if (!(t.length > 0) || !Number.isInteger(t.pieces) || t.pieces <= 0) return;
    setValue(`lines.${index}.qty`, termQty(t), { shouldValidate: true, shouldDirty: true });
    setValue(`lines.${index}.note`, buildDimNote(dim.user, t, dim.ratio), { shouldDirty: true });
  };
  const numIn = (v: string) => { const n = Number(v.replace(",", ".")); return Number.isFinite(n) ? n : 0; };

  const cell = "border border-border p-1.5 align-middle"; // ô có viền: bảng dạng lưới như bảng tính
  return (
    <tr className="align-middle">
      <td data-stt className={`${cell} text-center tabular text-fg-secondary`}>{index + 1}</td>
      <td className={cell} data-line-product={index} data-label="Sản phẩm" data-wide>
        <div className="flex items-center gap-2">
          <ProductThumb url={product?.imageUrl} name={product?.label} />
          <div className="min-w-0 flex-1">
            <Controller control={control} name={`lines.${index}.productId`} render={({ field }) => (
              <Combobox hideLabel label={`Sản phẩm dòng ${index + 1}`} value={product} loadOptions={loadProducts} placeholder="Tìm mã, tên…" error={err?.productId?.message}
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
              {(product?.groupName || dto?.onHand !== undefined) && (
                <p>{product?.groupName && <>Nhóm: {product.groupName}</>}{product?.groupName && dto?.onHand !== undefined && <span className="px-1 text-fg-muted">|</span>}{dto?.onHand !== undefined && <>Tồn: {formatQty(dto.onHand)} {dto.baseUnit}</>}</p>
              )}
              {short && <p role="status" className="font-medium text-warning">Không đủ tồn — sẽ thành đơn treo</p>}
              {dto?.lastSalePrice != null && <p>Giá gần nhất{dto.lastSalePriceForPartner ? " (khách này)" : " (khách khác)"}: {areaRow ? `${formatCurrency(pricePerM2(Number(dto.lastSalePrice), rowRatio))}/m²` : `${formatCurrency(dto.lastSalePrice)}/${dto.baseUnit}`}</p>}
              {dto?.lastPurchasePrice != null && <p>Giá nhập gần nhất: {areaRow ? `${formatCurrency(pricePerM2(Number(dto.lastPurchasePrice), rowRatio))}/m²` : `${formatCurrency(dto.lastPurchasePrice)}/${dto.baseUnit}`}</p>}
            </div>
          </div>
        </div>
      </td>
      <td data-label="ĐVT" className={cell}>
        {/* Điều khiển bằng state: select không điều khiển bị đặt giá trị trước khi <option> kịp render nên hiện trống */}
        <select aria-label={`Đơn vị dòng ${index + 1}`} value={line?.unit ?? ""} className={inputClass(err?.unit)}
          onChange={(e) => { setValue(`lines.${index}.unit`, e.target.value, { shouldValidate: true, shouldDirty: true }); setValue(`lines.${index}.salePrice`, undefined as never); }}>
          <option value="">—</option>
          {(product?.units ?? []).map((u) => <option key={u.unit} value={u.unit}>{u.unit}</option>)}
        </select>
      </td>
      <td data-label="Số lượng" className={cell}><RhfNumberInput aria-label={`Số lượng dòng ${index + 1}`} maxFrac={3} control={control} name={`lines.${index}.qty`}
        onKeyDown={onQtyKeyDown} className={`${inputClass(err?.qty)} tabular text-right`} />{areaRow && num(line?.qty) > 0 && <p className="mt-0.5 text-right text-xs text-fg-muted tabular">= {formatQty(Math.round(num(line?.qty) * rowRatio * 1000) / 1000)} m²</p>}</td>
      <td data-label="Đơn giá" className={cell}>
        {areaRow ? <>
        <NumberInput maxFrac={2} aria-label={`Đơn giá dòng ${index + 1}`} readOnly={!canEditPrice} value={num(line?.salePrice) ? pricePerM2(num(line?.salePrice), rowRatio) : ""}
          onValueChange={(val) => setValue(`lines.${index}.salePrice`, val === "" ? (undefined as never) : pricePerMd(Number(val), rowRatio), { shouldValidate: true, shouldDirty: true })} className={`${inputClass(err?.salePrice)} tabular text-right ${canEditPrice ? "" : "bg-hover"}`} />
        <p className="mt-0.5 text-right text-xs text-fg-muted">đ/m²</p>
        </> : <RhfNumberInput aria-label={`Đơn giá dòng ${index + 1}`} readOnly={!canEditPrice} maxFrac={2} control={control} name={`lines.${index}.salePrice`}
          className={`${inputClass(err?.salePrice)} tabular text-right ${canEditPrice ? "" : "bg-hover"}`} />}
      </td>
      <td data-label="CK trừ ngay" className={cell}>
        <RhfNumberInput aria-label={`Chiết khấu trừ ngay dòng ${index + 1}`} control={control} name={`lines.${index}.discountNow`} className={`${inputClass(err?.discountNow)} tabular text-right`} />
        {err?.discountNow?.message && <p role="alert" className="mt-1 text-xs text-danger">{err.discountNow.message}</p>}
      </td>
      <td data-label="CK tích lũy" className={cell}><RhfNumberInput aria-label={`Chiết khấu tích lũy dòng ${index + 1}`} control={control} name={`lines.${index}.discountAccum`} className={`${inputClass(err?.discountAccum)} tabular text-right`} /></td>
      <td data-label="Gia công" className={cell}>
        <select aria-label={`Kiểu gia công dòng ${index + 1}`} value={line?.processingTypeId ?? ""} onChange={(e) => { setValue(`lines.${index}.processingTypeId`, e.target.value ? Number(e.target.value) : null, { shouldDirty: true }); if (line?.id === undefined) setValue(`lines.${index}.salePrice`, undefined as never); setLengthExpr(""); setDimError("");
          const t = e.target.value ? types.find((x) => Number(x.value) === Number(e.target.value)) : null;
          if (t?.priceBasis === "UNIT" && t.unit) { const u = product?.units.find((x) => sameUnit(x.unit, t.unit)); if (u) setValue(`lines.${index}.unit`, u.unit, { shouldValidate: true, shouldDirty: true }); else setDimError(`Sản phẩm chưa khai đơn vị "${t.unit}" (Sản phẩm → Đơn vị & quy đổi).`); }
        }} className={inputClass()}>
          <option value="">Không</option>
          {types.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {currentType && !currentType.hasBom && <p className="mt-1 text-xs text-fg-muted">Chưa có định mức: bán như hàng thường (kho trừ chính sản phẩm).</p>}
        {typeId && (
          <div className="mt-2 space-y-1.5 text-xs">
            {!isUnitBasis && !ratioKnown && (
              <label className="flex items-center gap-1">Tỷ lệ m²/md
                <input aria-label={`Tỷ lệ m²/md dòng ${index + 1}`} inputMode="decimal" value={ratioInput} onChange={(e) => setRatioInput(e.target.value)} placeholder="1" className={`${inputClass()} w-20 tabular text-right`} />
              </label>
            )}
            {!isUnitBasis && ratio > 0 && !dim && (<>
              <label className="flex items-center gap-1">Chiều dài
                <input aria-label={`Chiều dài dòng ${index + 1}`} value={lengthExpr} onChange={(e) => { setLengthExpr(e.target.value); setDimError(""); }} onBlur={submitLength}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitLength(); } }} placeholder="7.1*7+6.8*1" className={`${inputClass()} w-32`} />
              </label>
              <p className="text-fg-muted">Dài*số tấm, nối bằng +; Enter để tách dòng. Tỷ lệ {String(ratio).replace(".", ",")} m²/md.</p>
            </>)}
            {dimError && <p role="alert" className="text-danger">{dimError}</p>}
          </div>
        )}
      </td>
      <td data-label="Ghi chú" className={cell} data-wide={dim ? true : undefined}>
        {dim ? (<>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <input aria-label={`Chiều dài (m) dòng ${index + 1}`} inputMode="decimal" defaultValue={String(dim.length).replace(".", ",")} key={`l${dim.length}`} onBlur={(e) => { const v = numIn(e.target.value); if (v > 0 && v !== dim.length) setDim({ length: v }); else e.target.value = String(dim.length).replace(".", ","); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }} className={`${inputClass()} w-20 tabular text-right`} />
            <span>{areaRow ? `m × ${String(dim.ratio).replace(".", ",")} ×` : "m ×"}</span>
            <input aria-label={`Số tấm dòng ${index + 1}`} inputMode="numeric" defaultValue={String(dim.pieces)} key={`p${dim.pieces}`} onBlur={(e) => { const v = numIn(e.target.value); if (Number.isInteger(v) && v > 0 && v !== dim.pieces) setDim({ pieces: v }); else e.target.value = String(dim.pieces); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }} className={`${inputClass()} w-14 tabular text-right`} />
            <span className="tabular">{areaRow ? `= ${String(termArea({ length: dim.length, pieces: dim.pieces }, dim.ratio)).replace(".", ",")} m² ×` : `= ${String(termQty({ length: dim.length, pieces: dim.pieces })).replace(".", ",")} m ×`}</span>
            <span className="tabular">{areaRow ? formatCurrency(pricePerM2(num(line?.salePrice), dim.ratio)) : formatCurrency(num(line?.salePrice))}</span>
            <span className="tabular">= {formatCurrency(amount)}</span>
          </div>
          <input aria-label={`Ghi chú dòng ${index + 1}`} maxLength={120} placeholder="Ghi chú thêm" value={dim.user} onChange={(e) => setValue(`lines.${index}.note`, buildDimNote(e.target.value, { length: dim.length, pieces: dim.pieces }, dim.ratio), { shouldDirty: true })} className={`${inputClass()} mt-1`} />
        </>) : <input aria-label={`Ghi chú dòng ${index + 1}`} maxLength={200} {...register(`lines.${index}.note`)} className={inputClass(err?.note)} />}
      </td>
      <td data-label="Thành tiền" className={cell}><div className="flex h-11 items-center justify-end rounded-sm bg-hover px-2 font-semibold tabular md:h-9">{formatCurrency(amount)}</div></td>
      <td data-action className={`${cell} text-center`}><button type="button" aria-label={`Xóa dòng ${index + 1}`} onClick={onRemove} disabled={!canRemove} className="inline-flex h-11 w-11 items-center justify-center rounded-sm text-danger hover:bg-danger-soft disabled:opacity-40 md:h-9 md:w-9"><Trash2 size={16} aria-hidden /></button></td>
    </tr>
  );
}

/** Ảnh sản phẩm 40px (hoặc khung trống có icon). Ảnh lỗi → quay về khung trống. */
function ProductThumb({ url, name }: { url?: string | null; name?: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) return <img src={url} alt={name ?? ""} loading="lazy" onError={() => setFailed(true)} className="h-10 w-10 shrink-0 rounded-sm border border-border object-cover" />;
  return <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-border bg-hover text-fg-muted"><Package size={18} /></span>;
}
