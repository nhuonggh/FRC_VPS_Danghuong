import type { PartnerKind } from "@/server/partners/codes";
export const KIND_UI: Record<PartnerKind, { base: string; api: "customers" | "suppliers"; title: string; singular: string }> = {
  customer: { base: "/sales/customers", api: "customers", title: "Khách hàng", singular: "khách hàng" },
  supplier: { base: "/purchase/suppliers", api: "suppliers", title: "Nhà cung cấp", singular: "nhà cung cấp" },
};
