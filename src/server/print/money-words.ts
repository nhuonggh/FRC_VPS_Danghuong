const digits = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
function group(n: number, full: boolean): string {
  const h = Math.floor(n / 100), t = Math.floor(n / 10) % 10, u = n % 10;
  const words: string[] = [];
  if (h || full) words.push(digits[h], "trăm");
  if (t > 1) words.push(digits[t], "mươi");
  else if (t === 1) words.push("mười");
  else if (u && (h || full)) words.push("lẻ");
  if (u) words.push(u === 1 && t > 1 ? "mốt" : u === 5 && t > 0 ? "lăm" : digits[u]);
  return words.join(" ");
}
/** Receives a server-rounded integer string; never parses a formatted currency. */
export function moneyInWords(integer: string): string {
  const negative = integer.startsWith("-");
  const value = integer.replace(/^-/, "").replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(value)) return "";
  if (value === "0") return "Không đồng";
  const groups: number[] = [];
  for (let end = value.length; end > 0; end -= 3) groups.push(Number(value.slice(Math.max(0, end - 3), end)));
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (!groups[i]) continue;
    const suffix = ["", "nghìn", "triệu"][i % 3] + (i >= 3 ? ` ${Array(Math.floor(i / 3)).fill("tỷ").join(" ")}` : "");
    parts.push(`${group(groups[i], parts.length > 0)} ${suffix}`.trim());
  }
  const result = `${negative ? "âm " : ""}${parts.join(" ")} đồng`;
  return result.charAt(0).toUpperCase() + result.slice(1);
}
