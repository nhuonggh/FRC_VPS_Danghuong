"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { formatCurrency, formatDate } from "@/lib/format";
export function LastSupplierPrice({ partnerId, productId }: { partnerId?: number; productId?: number }) {
  const [text, setText] = useState("Chọn nhà cung cấp và sản phẩm để xem giá gần nhất.");
  useEffect(() => {
    let active = true;
    setText("Chọn nhà cung cấp và sản phẩm để xem giá gần nhất.");
    if (partnerId && productId) {
      setText("Đang tra giá…");
      void apiFetch<{ price: string; unit: string; at: string } | null>(`/api/supplier-orders/last-price?partnerId=${partnerId}&productId=${productId}`)
        .then(r => { if (active) setText(r ? `${formatCurrency(r.price)}/${r.unit} · ${formatDate(r.at)}` : "Chưa có giá nhập từ nhà cung cấp này."); })
        .catch(() => { if (active) setText("Không tra được giá gần nhất."); });
    }
    return () => { active = false; };
  }, [partnerId, productId]);
  return <p className="mt-2 text-xs text-fg-secondary tabular">{text}</p>;
}
