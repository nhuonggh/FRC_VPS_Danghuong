"use client";

import { useRouter } from "next/navigation";
import { Combobox, type ComboOption } from "@/components/ui";

interface ProductOption extends ComboOption { baseUnit?: string }

/** Chọn sản phẩm cho báo cáo kho. Giá trị được giữ trên URL để có thể chia sẻ/refresh. */
export function ProductPicker({ productId, label }: { productId?: number; label?: string }) {
  const router = useRouter();
  const value = productId && label ? { value: productId, label } : null;

  async function loadOptions(q: string): Promise<ProductOption[]> {
    const response = await fetch(`/api/products/search?q=${encodeURIComponent(q)}`);
    if (!response.ok) throw new Error("Không tải được sản phẩm");
    return response.json() as Promise<ProductOption[]>;
  }

  return <div className="w-full sm:w-96"><Combobox
    label="Sản phẩm"
    value={value}
    onChange={(option) => router.push(option ? `/inventory/ledger?product=${option.value}` : "/inventory/ledger")}
    loadOptions={loadOptions}
    placeholder="Tìm mã hoặc tên sản phẩm…"
  /></div>;
}
