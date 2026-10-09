/** Giá theo tỷ trọng ↔ đơn giá theo đơn vị gốc. `factor` = tỷ trọng = số đơn vị quy đổi (vd kg) trên 1 đơn vị gốc (vd md). */
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Đơn giá/đơn vị gốc = giá/đơn vị quy đổi × tỷ trọng (vd 20.000 đ/kg × 2,4 kg/md = 48.000 đ/md). */
export const priceFromWeight = (perWeightUnit: number, factor: number) => (factor > 0 ? r2(perWeightUnit * factor) : 0);
/** Giá/đơn vị quy đổi = đơn giá/đơn vị gốc ÷ tỷ trọng. */
export const priceToWeight = (perBase: number, factor: number) => (factor > 0 ? r2(perBase / factor) : 0);
