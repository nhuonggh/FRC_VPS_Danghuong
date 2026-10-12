"use client";

import { useCallback, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";

/** Kiểu gia công đã gắn cho sản phẩm (Sản phẩm → tab Gia công); `ratio` = tỷ lệ m²/md đã lưu, null = chưa khai báo. */
export type ProcessingOption = { value: number | string; label: string; ratio: number | null; priceBasis?: "LENGTH" | "AREA" | "UNIT"; /** ĐVT riêng của kiểu (kg, bình, cây…) khi priceBasis = UNIT. */ unit?: string | null };
export type ProcessingOptions = ReadonlyMap<number, ProcessingOption[]>;

/** Nạp (một lần mỗi sản phẩm) danh sách kiểu gia công của sản phẩm để dòng nhập/báo giá chọn. */
export function useProcessingOptions() {
  const [options, setOptions] = useState<ProcessingOptions>(new Map());
  const asked = useRef(new Set<number>());
  const ensure = useCallback((productId: number | undefined) => {
    if (!productId || asked.current.has(productId)) return;
    asked.current.add(productId);
    apiFetch<ProcessingOption[]>(`/api/orders/options/processing-types?productId=${productId}`).then((rows) => setOptions((m) => new Map(m).set(productId, rows))).catch(() => asked.current.delete(productId));
  }, []);
  return { options, ensure };
}
