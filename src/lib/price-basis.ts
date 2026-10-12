import { normalizeSearch } from "@/lib/search";

/** Cách tính giá của kiểu gia công: LENGTH = giá/md, AREA = giá/m², UNIT = giá theo ĐVT riêng của kiểu (kg, bình, cây…). */
export type PriceBasisValue = "LENGTH" | "AREA" | "UNIT";

const LENGTH_WORDS = new Set(["m", "md", "met", "met dai", "dai"]);
const AREA_WORDS = new Set(["m2", "met vuong", "vuong"]);
const UNIT_WORDS = new Set(["theo dvt", "dvt", "don vi", "theo don vi"]);

/** ĐVT là mét dài / mét vuông / đơn vị khác (kg, bình, cây…); trống → null. */
export function unitKind(unit: string | null | undefined): "LENGTH" | "AREA" | "OTHER" | null {
  const u = normalizeSearch(unit ?? "").replace(/²/g, "2").trim();
  if (!u) return null;
  if (LENGTH_WORDS.has(u)) return "LENGTH";
  if (AREA_WORDS.has(u)) return "AREA";
  return "OTHER";
}

/**
 * Suy ra "Tính giá theo" từ hai ô Excel: ĐVT (cột E) và Tính giá theo (cột F). Cột E thắng khi là đơn vị khác mét (kg, bình, cây…):
 * kiểu đó bán theo đúng ĐVT, không có tỷ lệ m²/md. Còn lại cột F quyết định (Mét dài/Mét vuông); F trống thì suy từ E.
 * F ghi thẳng tên đơn vị (vd "bình") cũng được hiểu là theo ĐVT, và nếu ĐVT trống thì lấy luôn làm ĐVT.
 * `basis` undefined = không có thông tin → giữ nguyên (mặc định của DB khi tạo mới).
 */
export function resolvePriceBasis(unitRaw: string, basisRaw: string): { basis: PriceBasisValue | undefined; unit: string; error?: string } {
  const unit0 = unitRaw.trim(), basisText = basisRaw.trim();
  const b = normalizeSearch(basisText).replace(/²/g, "2").trim();
  const bKind: PriceBasisValue | "TEXT" | null = !b ? null : LENGTH_WORDS.has(b) ? "LENGTH" : AREA_WORDS.has(b) ? "AREA" : UNIT_WORDS.has(b) ? "UNIT" : "TEXT";
  const unit = !unit0 && bKind === "TEXT" ? basisText : unit0;
  const uKind = unitKind(unit);
  if (uKind === "OTHER") return { basis: "UNIT", unit };
  if (bKind === "UNIT") return uKind ? { basis: "UNIT", unit } : { basis: undefined, unit, error: "Tính giá theo ĐVT nhưng chưa nhập ĐVT." };
  if (bKind === "LENGTH" || bKind === "AREA") return { basis: bKind, unit };
  if (bKind === "TEXT" && uKind) return { basis: undefined, unit, error: `Tính giá theo "${basisText}" không hợp lệ (Mét dài, Mét vuông hoặc Theo ĐVT).` };
  return { basis: uKind === "LENGTH" ? "LENGTH" : uKind === "AREA" ? "AREA" : undefined, unit };
}

/** Hai tên đơn vị có cùng một đơn vị không (bỏ dấu/hoa thường: "Bình" ≡ "bình")? */
export const sameUnit = (a: string | null | undefined, b: string | null | undefined) => normalizeSearch(a ?? "").trim() === normalizeSearch(b ?? "").trim() && normalizeSearch(a ?? "").trim() !== "";
