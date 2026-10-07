/**
 * Biểu thức chiều dài khi bán tôn theo kích thước: "7.1*7+6.8*1" = 7,1 m × 7 tấm + 6,8 m × 1 tấm.
 * Mỗi số hạng là `dài*số tấm` (dùng * hoặc x, dấu phẩy hoặc chấm thập phân); số hạng chỉ có `dài` = 1 tấm.
 */
export interface LengthTerm { length: number; pieces: number }

const NUM = /^\d+(?:[.,]\d+)?$/;
const toNum = (s: string) => Number(s.replace(",", "."));

export function parseLengthExpr(input: string): { terms: LengthTerm[] } | { error: string } {
  const text = input.trim().replace(/\s+/g, "").replace(/[×xX]/g, "*");
  if (!text) return { error: "Nhập chiều dài, vd 7.1*7+6.8*1." };
  const terms: LengthTerm[] = [];
  for (const part of text.split("+")) {
    const bits = part.split("*");
    if (bits.length > 2 || bits.some((b) => !NUM.test(b))) return { error: `Không hiểu "${part}". Dùng dạng dài*số tấm, nối bằng dấu +.` };
    const length = toNum(bits[0]!), pieces = bits[1] === undefined ? 1 : toNum(bits[1]);
    if (!(length > 0)) return { error: "Chiều dài phải lớn hơn 0." };
    if (!Number.isInteger(pieces) || pieces <= 0) return { error: "Số tấm phải là số nguyên dương." };
    if (Number(length.toFixed(3)) !== length) return { error: "Chiều dài tối đa 3 chữ số thập phân." };
    terms.push({ length, pieces });
  }
  return { terms };
}

const r = (v: number, d: number) => Number(v.toFixed(d));
/** Số md tôn (SL dòng, đơn vị gốc) và diện tích m² bán ra của một số hạng. */
export const termQty = (t: LengthTerm) => r(t.length * t.pieces, 3);
export const termArea = (t: LengthTerm, ratio: number) => r(t.length * ratio * t.pieces, 3);
/** Đơn giá theo md = đơn giá m² × tỷ lệ (làm tròn 2 số, đúng cột salePrice). */
export const pricePerMd = (pricePerM2: number, ratio: number) => r(pricePerM2 * ratio, 2);
export const pricePerM2 = (perMd: number, ratio: number) => (ratio > 0 ? r(perMd / ratio, 2) : 0);
const fmt = (v: number) => String(v).replace(".", ",");
/** Ghi chú dòng: "7,1 m × 1,08 × 7 = 53,676 m²". */
export const termNote = (t: LengthTerm, ratio: number) => `${fmt(t.length)} m × ${fmt(ratio)} × ${t.pieces} = ${fmt(termArea(t, ratio))} m²`;
