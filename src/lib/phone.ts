/**
 * Khoá nhận diện SĐT: chỉ giữ chữ số, +84/84 → 0. Dưới 8 số ⇒ "" (không đủ để nhận diện).
 * Dùng cho hồ sơ khách lẻ thân quen (một SĐT = một hồ sơ).
 */
export function normalizePhone(input: string | null | undefined): string {
  let d = (input ?? "").replace(/\D/g, "");
  if (d.startsWith("84") && d.length >= 11) d = `0${d.slice(2)}`;
  return d.length >= 8 && d.length <= 15 ? d : "";
}
