"use client";

import { useCallback } from "react";

interface Options<L> {
  /** Số dòng hiện tại. */
  count: number;
  /** Đọc giá trị các dòng hiện tại (form.getValues). */
  getLines: () => readonly (L | undefined)[];
  append: (value: L, opts?: { shouldFocus?: boolean }) => void;
  remove: (indexes: number[]) => void;
  /** Dòng trống mới. */
  blank: L;
  /** Dòng đã có dữ liệu? Mặc định: có productId hoặc qty. */
  isFilled?: (line: L | undefined) => boolean;
  /** `aria-label` của ô số lượng dòng i (0-based) — để chuyển focus sau khi chọn SP. */
  qtyLabel: (index: number) => string;
  max?: number;
}

const defaultFilled = (l: unknown) => {
  const line = l as { productId?: number; materialProductId?: number; qty?: number; actualQty?: number; qtyPerUnit?: number } | undefined;
  return !!(line?.productId || line?.materialProductId || Number(line?.qty) || Number(line?.actualQty) || Number(line?.qtyPerUnit));
};

/**
 * Nhập dòng hàng nhanh bằng bàn phím cho form dùng `useFieldArray`:
 * chọn SP ở dòng cuối → tự mở dòng trống kế + focus ô SL; Enter ở ô SL → sang ô tìm SP dòng kế; dòng trống bị bỏ khi lưu.
 * Ô tìm SP của dòng i nằm trong phần tử có `data-line-product={i}`.
 */
export function useLineEntry<L>({ count, getLines, append, remove, blank, isFilled = defaultFilled, qtyLabel, max = Number.POSITIVE_INFINITY }: Options<L>) {
  const focusProduct = useCallback((i: number) => requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-line-product="${i}"] input`)?.focus())), []);
  const focusQty = useCallback((i: number) => requestAnimationFrame(() => document.querySelector<HTMLElement>(`input[aria-label="${qtyLabel(i)}"]`)?.focus()), [qtyLabel]);

  /** Bỏ dòng trống trước khi kiểm tra/lưu — trừ khi mọi dòng đều trống (để hiện lỗi). */
  const dropEmptyLines = useCallback(() => {
    const cur = getLines();
    const empty = cur.map((l, i) => (isFilled(l) ? -1 : i)).filter((i) => i >= 0);
    if (empty.length > 0 && empty.length < cur.length) remove(empty);
  }, [getLines, isFilled, remove]);

  const onProductPicked = useCallback((i: number) => {
    if (i === count - 1 && count < max) append(blank, { shouldFocus: false });
    focusQty(i);
  }, [count, max, append, blank, focusQty]);

  const nextLine = useCallback((i: number) => {
    if (i === count - 1) { if (count >= max) return; append(blank, { shouldFocus: false }); }
    focusProduct(i + 1);
  }, [count, max, append, blank, focusProduct]);

  /** Gắn vào onKeyDown của ô SL. */
  const onQtyKeyDown = (i: number) => (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); nextLine(i); } };

  return { dropEmptyLines, onProductPicked, nextLine, onQtyKeyDown };
}
