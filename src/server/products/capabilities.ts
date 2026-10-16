/** Classification describes products; capabilities control their business use. */
export const PRODUCT_CAPABILITIES = [
  { value: "canSell", label: "Được bán" },
  { value: "canPurchase", label: "Được mua" },
  { value: "canUseAsMaterial", label: "Dùng làm nguyên liệu" },
  { value: "canProduce", label: "Được sản xuất" },
] as const;
export type ProductCapability = (typeof PRODUCT_CAPABILITIES)[number]["value"];
export type ProductCapabilities = Record<ProductCapability, boolean>;
export const isProductCapability = (v: string): v is ProductCapability => PRODUCT_CAPABILITIES.some((c) => c.value === v);
/** ASSUMPTION: preserve legacy buying/selling; classification seeds initial BOM eligibility only. */
export const defaultCapabilities = (kind: string): ProductCapabilities => ({ canSell: true, canPurchase: true, canUseAsMaterial: ["NVL", "HANG", "PHU_KIEN"].includes(kind), canProduce: ["THANH_PHAM", "PHU_KIEN"].includes(kind) });
export const capabilityValues = (p: ProductCapabilities): ProductCapabilities => ({ canSell: p.canSell, canPurchase: p.canPurchase, canUseAsMaterial: p.canUseAsMaterial, canProduce: p.canProduce });
export const capabilityLabel = (p: ProductCapabilities) => PRODUCT_CAPABILITIES.filter((c) => p[c.value]).map((c) => c.label).join(" · ") || "Chưa bật khả năng sử dụng";
