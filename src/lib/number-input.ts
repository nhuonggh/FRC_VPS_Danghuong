/** Logic thuần cho ô nhập số kiểu VN (chấm ngăn nghìn, phẩy thập phân) — dùng bởi components/ui/NumberInput. */

export interface NumberInputOpts { maxFrac: number; allowNegative: boolean }

const group = (int: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/**
 * Làm sạch chữ người dùng gõ: bỏ mọi thứ ngoài chữ số, một dấu phẩy thập phân và dấu trừ đầu chuỗi (nếu cho phép);
 * dấu chấm là dấu ngăn nghìn nên bị bỏ. Trả về chuỗi hiển thị đã gom nhóm, và số chữ số trước vị trí con trỏ để đặt lại con trỏ.
 */
export function normalizeTyped(raw: string, caret: number, opts: NumberInputOpts): { text: string; caret: number } {
  let neg = false, int = "", frac = "", comma = false;
  let digitsBefore = 0; // số ký tự "có nghĩa" (chữ số / phẩy / trừ) đứng trước con trỏ trong chuỗi mới
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    const before = i < caret;
    if (c >= "0" && c <= "9") {
      if (comma) { if (frac.length >= opts.maxFrac) continue; frac += c; } else int += c;
      if (before) digitsBefore++;
    } else if (c === "," && opts.maxFrac > 0 && !comma) { comma = true; if (before) digitsBefore++; }
    else if (c === "-" && opts.allowNegative && !neg && int === "" && !comma) { neg = true; if (before) digitsBefore++; }
  }
  int = int.replace(/^0+(?=\d)/, "");
  const text = `${neg ? "-" : ""}${group(int)}${comma ? "," + frac : ""}`;
  // đặt con trỏ sau `digitsBefore` ký tự có nghĩa trong chuỗi mới (bỏ qua dấu chấm chèn thêm)
  let seen = 0, pos = 0;
  while (pos < text.length && seen < digitsBefore) { if (text[pos] !== ".") seen++; pos++; }
  return { text, caret: pos };
}

/** Chuỗi hiển thị → số chuẩn (dấu chấm thập phân, không nhóm); rỗng/chỉ "-" → "". "5," → "5". */
export function textToCanonical(text: string): string {
  const t = text.replace(/\./g, "").replace(",", ".");
  if (t === "" || t === "-" || t === "." || t === "-.") return "";
  return t.endsWith(".") ? t.slice(0, -1) : t;
}

/** Giá trị ngoài (number/chuỗi chuẩn dấu chấm thập phân) → chuỗi hiển thị; null/rỗng/NaN → "". */
export function canonicalToText(value: unknown, opts: NumberInputOpts): string {
  if (value === null || value === undefined || value === "") return "";
  let s = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : String(value).trim();
  if (!s) return "";
  if (/e/i.test(s)) { const n = Number(s); if (!Number.isFinite(n)) return ""; s = n.toFixed(Math.max(opts.maxFrac, 6)); }
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === "" && !m[3])) return "";
  const [, sign = "", i = "", f = ""] = m;
  let frac = f;
  if (frac.length > opts.maxFrac) {
    // làm tròn half-up trên chuỗi thập phân
    const up = frac.charCodeAt(opts.maxFrac) >= 53;
    frac = frac.slice(0, opts.maxFrac);
    if (up) {
      const digits = (i || "0") + frac; const out = digits.split(""); let k = out.length - 1;
      for (; k >= 0; k--) { if (out[k] === "9") out[k] = "0"; else { out[k] = String(Number(out[k]) + 1); break; } }
      const joined = (k < 0 ? "1" : "") + out.join("");
      const intLen = joined.length - frac.length;
      return finish(sign, joined.slice(0, intLen), joined.slice(intLen));
    }
  }
  return finish(sign, i || "0", frac);
}

function finish(sign: string, int: string, frac: string): string {
  frac = frac.replace(/0+$/, "");
  const intClean = int.replace(/^0+(?=\d)/, "");
  const zero = !/[1-9]/.test(intClean + frac);
  return `${sign && !zero ? "-" : ""}${group(intClean)}${frac ? "," + frac : ""}`;
}

/** Hai giá trị chuẩn có cùng số không (so theo số: "0.50" ≡ "0.5", "" ≡ "")? */
export function sameNumber(a: string, b: string): boolean {
  if (a === "" || b === "") return a === b;
  return a === b || Number(a) === Number(b);
}

/** Dán từ clipboard (kiểu VN hoặc kiểu quốc tế) → chuỗi hiển thị thô để `normalizeTyped` làm sạch. */
export function pastedToTyped(clip: string): string {
  const s = clip.replace(/[\s'₫đ]|vnd/gi, "");
  const dots = s.split(".").length - 1, commas = s.split(",").length - 1;
  if (dots && commas) return s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "") : s.replace(/,/g, "").replace(".", ",");
  if (commas > 1) return s.replace(/,/g, "");
  if (dots > 1) return s.replace(/\./g, "");
  if (dots === 1) { const [i = "", f = ""] = s.split("."); return f.length === 3 && i.length >= 1 && i.length <= 3 && !i.startsWith("0") ? i + f : `${i},${f}`; }
  return s;
}
