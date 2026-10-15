export type ParsedNumber = { ok: true; value: string | null } | { ok: false; message: string };
interface Opts { allowNegative?: boolean; maxFrac?: number }
const invalid: ParsedNumber = { ok: false, message: "Số không hợp lệ." };
const count = (s: string, c: string) => s.split(c).length - 1;
function finish(negative: boolean, intPart: string, fracPart: string, opts: Opts): ParsedNumber { if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return invalid; const frac = fracPart.replace(/0+$/, ""); const max = opts.maxFrac ?? 6; if (frac.length > max) return { ok: false, message: `Tối đa ${max} chữ số thập phân.` }; const int = intPart.replace(/^0+(?=\d)/, "") || "0"; const zero = int === "0" && !frac; if (negative && !zero && !opts.allowNegative) return { ok: false, message: "Không được là số âm." }; return { ok: true, value: `${negative && !zero ? "-" : ""}${int}${frac ? `.${frac}` : ""}` }; }
/** Đọc số kiểu VN: dấu chấm ngăn nghìn, dấu phẩy thập phân; ô trống luôn là null. */
export function parseViNumber(raw: unknown, opts: Opts = {}): ParsedNumber {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw === "number") { if (!Number.isFinite(raw)) return invalid; let n = String(raw); if (/e/i.test(n)) n = raw.toFixed(12).replace(/0+$/, "").replace(/\.$/, ""); const negative = n.startsWith("-"); const [i = "", f = ""] = (negative ? n.slice(1) : n).split("."); return finish(negative, i, f, opts); }
  if (typeof raw !== "string") return invalid;
  const s = raw.replace(/[\s ']/g, "").replace(/(₫|đ|vnd)$/i, ""); if (!s) return { ok: true, value: null };
  const m = /^([+-]?)([\d.,]+)$/.exec(s); if (!m) return invalid;
  const negative = m[1] === "-"; const body = m[2]!; const dots = count(body, "."); const commas = count(body, ","); let int = ""; let frac = "";
  if (dots && commas) { const dec = body.lastIndexOf(",") > body.lastIndexOf(".") ? "," : "."; const thou = dec === "," ? "." : ","; if (count(body, dec) !== 1) return invalid; const [i = "", f = ""] = body.split(dec); const groups = i.split(thou); if (groups.slice(1).some((g) => g.length !== 3) || !groups[0] || groups[0].length > 3) return invalid; int = groups.join(""); frac = f; }
  else if (commas) { if (commas > 1) return invalid; [int = "", frac = ""] = body.split(","); }
  else if (dots > 1) { const groups = body.split("."); if (groups.slice(1).some((g) => g.length !== 3) || !groups[0] || groups[0].length > 3) return invalid; int = groups.join(""); }
  else if (dots === 1) { const [i = "", f = ""] = body.split("."); if (f.length === 3 && i.length >= 1 && i.length <= 3 && !i.startsWith("0")) int = i + f; else { int = i; frac = f; } }
  else int = body;
  return int || frac ? finish(negative, int, frac, opts) : invalid;
}
