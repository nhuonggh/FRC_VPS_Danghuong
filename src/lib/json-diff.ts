export interface DiffEntry {
  path: string;
  before: unknown;
  after: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** So sánh sâu, KHÔNG phụ thuộc thứ tự khoá (jsonb của Postgres không giữ thứ tự khoá); thứ tự mảng có nghĩa. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

function flatten(v: unknown, prefix: string, out: Map<string, unknown>): void {
  if (isObj(v) && Object.keys(v).length > 0) {
    for (const [k, x] of Object.entries(v)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
    return;
  }
  // Gốc null/undefined/{} = "không có gì" (tạo mới / xóa) → không sinh dòng nào.
  if (prefix === "" && (v === null || v === undefined || isObj(v))) return;
  // Lá: nguyên thuỷ, mảng (một giá trị), object rỗng lồng trong object, hoặc null ("a": null ≠ vắng mặt).
  out.set(prefix, v);
}

/**
 * So sánh 2 JSON thành danh sách (đường dẫn, số cũ, số mới), sắp theo đường dẫn (ổn định, không phụ thuộc thứ tự khoá).
 * Đường dẫn nối bằng dấu chấm; mảng được so như MỘT giá trị; vắng mặt = `undefined` (khác `null`).
 * Gốc là mảng/nguyên thuỷ → đường dẫn "". Chuỗi Decimal so theo chuỗi (không ép sang số).
 */
export function diffJson(before: unknown, after: unknown): DiffEntry[] {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  flatten(before, "", a);
  flatten(after, "", b);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  const out: DiffEntry[] = [];
  for (const path of paths) {
    const x = a.get(path);
    const y = b.get(path);
    if (!deepEqual(x, y)) out.push({ path, before: x, after: y });
  }
  return out;
}
