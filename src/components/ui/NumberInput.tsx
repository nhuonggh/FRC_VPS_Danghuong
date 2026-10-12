"use client";

import { useLayoutEffect, useRef, useState, type ClipboardEvent, type InputHTMLAttributes, type KeyboardEvent } from "react";
import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";
import { canonicalToText, normalizeTyped, pastedToTyped, sameNumber, textToCanonical, type NumberInputOpts } from "@/lib/number-input";

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type" | "inputMode" | "min" | "max" | "step">;

export interface NumberInputProps extends NativeProps {
  /** Giá trị chuẩn (dấu chấm thập phân) — chuỗi hoặc số; rỗng/null/undefined = ô trống. */
  value: string | number | null | undefined;
  /** Nhận số chuẩn (vd "1234.5"), "" khi xóa trống. */
  onValueChange: (value: string) => void;
  /** Số chữ số thập phân tối đa: tiền = 0 (mặc định), số lượng = 3. */
  maxFrac?: number;
  allowNegative?: boolean;
}

/**
 * Ô nhập số kiểu VN: hiển thị ngăn nghìn bằng dấu chấm (1.000.000), thập phân bằng dấu phẩy; phím "." hoặc "," đều gõ ra dấu phẩy
 * khi ô cho phép số lẻ (maxFrac > 0), còn ô tiền (maxFrac = 0) bỏ qua. Giá trị trả ra luôn là số chuẩn nên server/Zod không đổi.
 */
export function NumberInput({ value, onValueChange, maxFrac = 0, allowNegative = false, onKeyDown, onPaste, ...rest }: NumberInputProps) {
  const opts: NumberInputOpts = { maxFrac, allowNegative };
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => canonicalToText(value, opts));
  const caretRef = useRef<number | null>(null);

  // đồng bộ khi giá trị bên ngoài ĐỔI (tính tự động, reset form…) — chỉ khi prop thật sự đổi, để lần render trung gian
  // (state ô này đã cập nhật nhưng form chưa kịp) không ghi đè chữ đang gõ; và không ghi đè khi chính ô này vừa phát ra giá trị đó
  const ext = value === null || value === undefined ? "" : typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value;
  const [prevExt, setPrevExt] = useState(ext);
  if (ext !== prevExt) {
    setPrevExt(ext);
    const extCanon = ext === "" ? "" : textToCanonical(canonicalToText(ext, { maxFrac: Math.max(maxFrac, 6), allowNegative: true }));
    if (!sameNumber(extCanon, textToCanonical(text))) setText(canonicalToText(ext, opts));
  }

  useLayoutEffect(() => {
    if (caretRef.current !== null && ref.current && document.activeElement === ref.current) ref.current.setSelectionRange(caretRef.current, caretRef.current);
    caretRef.current = null;
  });

  const apply = (raw: string, caret: number) => {
    const n = normalizeTyped(raw, caret, opts);
    caretRef.current = n.caret;
    setText(n.text);
    onValueChange(textToCanonical(n.text));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "." || e.key === ",") {
      // dấu chấm là ngăn nghìn tự chèn: phím chấm/phẩy đều nghĩa là "thập phân" (nếu ô cho phép)
      e.preventDefault();
      if (maxFrac <= 0) return;
      const el = e.currentTarget, s = el.selectionStart ?? el.value.length, t = el.selectionEnd ?? s;
      apply(el.value.slice(0, s) + "," + el.value.slice(t), s + 1);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    onPaste?.(e);
    if (e.defaultPrevented) return;
    e.preventDefault();
    const el = e.currentTarget, s = el.selectionStart ?? el.value.length, t = el.selectionEnd ?? s;
    const clip = pastedToTyped(e.clipboardData.getData("text"));
    apply(el.value.slice(0, s) + clip + el.value.slice(t), s + clip.length);
  };

  return <input {...rest} ref={ref} type="text" inputMode={maxFrac > 0 ? "decimal" : "numeric"} autoComplete="off" value={text}
    onChange={(e) => apply(e.target.value, e.target.selectionStart ?? e.target.value.length)} onKeyDown={handleKeyDown} onPaste={handlePaste} />;
}

/** NumberInput gắn react-hook-form: lưu `number` (hoặc `empty` khi ô trống — mặc định undefined để Zod báo thiếu). */
export function RhfNumberInput<T extends FieldValues>({ control, name, empty, ...rest }: Omit<NumberInputProps, "value" | "onValueChange" | "name"> & { control: Control<T>; name: Path<T>; empty?: number | null }) {
  return <Controller control={control} name={name} render={({ field }) => (
    <NumberInput {...rest} name={field.name} value={field.value as number | string | null | undefined} onBlur={(e) => { field.onBlur(); rest.onBlur?.(e); }}
      onValueChange={(s) => field.onChange(s === "" ? empty : Number(s))} />
  )} />;
}
